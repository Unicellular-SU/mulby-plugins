import { ComicResponse, CharacterProfile, StoryMode, UsageStat, ImageProgress, DEFAULT_TEXT_MODEL_LABEL, LogUpdateFn } from "../engine-types";
import { getTheme } from "../theme/registry";
import type { MangaTheme } from "../theme/types";
import { normalizeSceneLists, summarizeNormalizeReport } from "../utils/normalizeSceneLists";
import {
  createAbortScope,
  safeAbort,
  createAttachmentCache,
  NO_TOOLS,
  dataUrlToBuffer,
  aspectRatioToSize,
  extractJson,
  toDataUrl,
} from '@mulby-plugins/manga-kit';

// ================= MULBY AI BRIDGE =================
// 所有 AI 能力通过 Mulby 宿主提供的 window.mulby.ai 完成，
// 模型在插件配置面板中选择（文本模型 / 图像模型），密钥由 Mulby 统一管理。
// 为了不改动各组件的 props 链，模型选择通过 setActiveModels 注入模块级状态。

let activeModels: { textModel: string; imageModel: string } = { textModel: '', imageModel: '' };

/** 由 App 在配置变化时调用，注入当前选择的模型 */
export const setActiveModels = (models: { textModel?: string; imageModel?: string }) => {
  activeModels = {
    textModel: models.textModel || '',
    imageModel: models.imageModel || ''
  };
};

const getAi = () => {
  const ai = (window as Window).mulby?.ai;
  if (!ai) {
    throw new Error("Mulby AI 接口不可用。请在 Mulby 中打开本插件，并确认已在 Mulby 设置中配置 AI 模型。");
  }
  return ai;
};

// ================= 全局中止（一键暂停所有任务） =================
// 纪元（epoch）机制：每次 abortAllAiTasks() 递增纪元；
// - 每个任务在开始时捕获当前纪元，跨 await 后发现纪元已变则抛 AbortError（丢弃结果）；
// - 文本流式调用额外登记 requestId，中止时通过 ai.abort(requestId) 真正杀掉请求；
// - 图像 edit 路径由插件自生成 requestId 随 input 传入并登记（第 6 章宿主分支支持真中止；
//   老宿主安全忽略该字段，abort 未知 id 仅产生 warn 日志，行为退化为"结果作废不写界面"）；
// - 图像 generate 路径已迁移 generateStream（方案 5.3）：新宿主经 chunk.__requestId 登记
//   进同一集合获得真中止；老宿主不发该 chunk，在途请求继续在服务端完成，
//   但结果会被作废，不会写入界面。
// 中止后新发起的任务捕获的是新纪元，无需任何重置即可正常运行。

// 方案 7.3：中止纪元五件套收编为 manga-kit 的 createAbortScope 工厂——模块级默认实例
// 即"每窗口一份"的现语义；对外导出签名保持不变（App 与各组件零改动）。
const scope = createAbortScope(() => (window as Window).mulby?.ai);

/** 当前中止纪元；队列型调用方（如资产连续生成循环）可在循环中比对以停止推进 */
export const getAbortEpoch = () => scope.epoch();

/** 本轮运行的回调是否已过期（用户中止过 / 新一轮已开始）——方案 2.1 的运行代际检查 */
export const isStale = (runEpoch: number) => !scope.isCurrent(runEpoch);

/** 一键中止：杀掉在途文本流请求与已登记 requestId 的图像 edit 请求，并作废所有在途任务的结果 */
export const abortAllAiTasks = () => scope.abortAll();

const ABORT_ERROR = () => new DOMException('Aborted', 'AbortError');

const throwIfAborted = (epoch: number) => scope.throwIfAborted(epoch);

/** 解析图像模型：优先用配置面板选择的模型，否则回退到第一个可用的图像生成模型 */
const resolveImageModel = async (): Promise<string> => {
  if (activeModels.imageModel) return activeModels.imageModel;
  const models = await getAi().allModels({ endpointType: 'image-generation' });
  if (!models || models.length === 0) {
    throw new Error("未找到可用的图像生成模型。请在 Mulby 设置 → AI → 模型管理中添加端点类型为「图像生成」的模型。");
  }
  return models[0].id;
};

// ================= 参考图附件缓存（方案 4.1，遵守 D3） =================
// 同一张参考图整轮会话只上传一次：key = dataUrl 前 256 字符 + 长度，
// value 为 Promise 化 attachmentId（并发页同时 miss 时也只上传一次）。
// 宿主 AttachmentStore 无 TTL、消费后不删除，跨页复用安全；命中后仍以
// attachments.get 校验失效（宿主重启等），失效即重传。

// 缓存实现收编进 manga-kit（方案 7.1，D3 语义原样平移）；此处保留模块级默认实例。
const attachmentCache = createAttachmentCache(() => (window as Window).mulby?.ai);

const uploadRefCached = (ai: ReturnType<typeof getAi>, dataUrl: string): Promise<string> =>
  attachmentCache.upload(ai, dataUrl);

/**
 * 删除全部已缓存附件并清空缓存；新剧本生成成功与 Start Over 确认丢弃时调用（D3）。
 * 宿主对附件无 TTL / 会话清理任务，批量 delete 属必要清理而非锦上添花。
 */
export const clearReferenceAttachmentCache = () => attachmentCache.clear();

// ================= 费用统计如实上报（方案 5.2） =================

/** 最后兜底的粗估（中文保守系数 ~2 字符/token；仅在 tokens.estimate 不可用时使用） */
const roughTokens = (text: string) => Math.ceil(text.length / 2);

/**
 * 文本 usage 兜底：优先走宿主 ai.tokens.estimate（js-tiktoken 真分词），
 * 老宿主 / 调用失败回退到中文保守系数（方案 5.2 步骤 3）。
 */
const estimateTextUsage = async (
  model: string | undefined,
  prompt: string,
  outputText: string
): Promise<{ inputTokens: number; outputTokens: number }> => {
  const est = ((window as Window).mulby?.ai as { tokens?: { estimate?: Function } } | undefined)?.tokens?.estimate;
  if (typeof est === 'function') {
    try {
      const r = await est({
        ...(model ? { model } : {}),
        messages: [{ role: 'user', content: prompt }],
        outputText,
      });
      if (typeof r?.inputTokens === 'number' && typeof r?.outputTokens === 'number') {
        return { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
      }
    } catch { /* fall through */ }
  }
  return { inputTokens: roughTokens(prompt), outputTokens: roughTokens(outputText) };
};

/** 文本调用统一构造 UsageStat：modelId 如实取当前选择（留空 = 宿主默认路由，插件不可知） */
const textStat = (
  inputTokens: number,
  outputTokens: number,
  estimated: boolean
): UsageStat => ({
  kind: 'text',
  modelId: activeModels.textModel || DEFAULT_TEXT_MODEL_LABEL,
  inputTokens,
  outputTokens,
  imagesGenerated: 0,
  estimated,
});

/**
 * 图像调用统一构造 UsageStat：token 记宿主返回的原始值（恒为 0/16 的占位，不用于计价——
 * 计价在 App 层按张查 services/pricing.ts），不再伪造 560/1120 常数。
 */
const imageStat = (
  modelId: string,
  tokens: { inputTokens?: number; outputTokens?: number } | undefined
): UsageStat => ({
  kind: 'image',
  modelId,
  inputTokens: tokens?.inputTokens || 0,
  outputTokens: tokens?.outputTokens || 0,
  imagesGenerated: 1,
  estimated: false,
});

// ================= 图像流式进度统一封装（方案 5.3，维持 D1 epoch） =================
// 仅无参考图路径（generate）走流式；带参考图的 edit 无 stream 变体，保持现状。
// chunk.__requestId 为第 6 章宿主分支（feat/ai-image-abort-and-size）新增：登记进
// abort scope 的 requestId 集合，abortAllAiTasks 即可真杀在途请求；老宿主永不发该
// chunk，自然退化为"结果作废不写界面"（D6，无需显式探测）。

const generateImageWithProgress = async (
  ai: ReturnType<typeof getAi>,
  input: { model: string; prompt: string; size: string; count: number },
  epoch: number,
  onProgress?: (p: ImageProgress) => void
): Promise<{ images: string[]; tokens: { inputTokens: number; outputTokens: number } }> => {
  if (typeof ai.images?.generateStream !== 'function') {
    return ai.images.generate(input); // 特性探测降级：老宿主走非流式，功能零回归
  }
  let requestId: string | null = null;
  try {
    return await ai.images.generateStream(input, (chunk: any) => {
      if (chunk?.__requestId) {
        requestId = chunk.__requestId;
        if (!scope.trackIfCurrent(epoch, chunk.__requestId)) {
          safeAbort(ai, chunk.__requestId); // 捕获到句柄时已被中止：立即杀掉
        }
        return;
      }
      if (!scope.isCurrent(epoch) || !onProgress) return; // 中止后迟到 chunk 丢弃（D1）
      onProgress({
        stage: chunk?.stage,
        message: chunk?.message,
        preview: chunk?.type === 'preview' && chunk?.image ? toDataUrl(chunk.image) : undefined,
        received: chunk?.received,
        total: chunk?.total,
      });
    });
  } finally {
    if (requestId) scope.untrack(requestId);
  }
};

export const refineText = async (
  originalText: string,
  instruction: string,
  context: string,
  onUsage?: (stat: UsageStat) => void
): Promise<string> => {
  const ai = getAi();

  const prompt = `
    Role: Professional Manga Editor & Script Doctor.
    Task: Refine, rewrite, or optimize the following text based strictly on the user's instructions.

    Context about the Manga:
    ${context}

    Original Text to Modify:
    """
    ${originalText}
    """

    User Instruction:
    "${instruction}"

    CRITICAL EDITING RULES:
    1. **UNIVERSE FIDELITY**: ${getTheme().refineToneHint}
    2. **NO ABSTRACTION**: Do NOT summarize dialogue (e.g., "He explains the plan"). Write the FULL, RICH dialogue.
    3. **CHARACTER VOICE**: Ensure characters sound exactly like their canonical anime/manga counterparts.

    Output: Return ONLY the refined text. Do not include markdown formatting or explanations.
  `;

  const epoch = scope.epoch();

  try {
    const res = await ai.call({
        ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
        messages: [{ role: 'user', content: prompt }],
        ...NO_TOOLS
    });

    throwIfAborted(epoch);

    const content = typeof res?.content === 'string' ? res.content.trim() : '';

    if (onUsage) {
      const u = res?.usage;
      if (typeof u?.inputTokens === 'number' && typeof u?.outputTokens === 'number') {
        onUsage(textStat(u.inputTokens, u.outputTokens, false));
      } else {
        const est = await estimateTextUsage(activeModels.textModel || undefined, prompt, content);
        onUsage(textStat(est.inputTokens, est.outputTokens, true));
      }
    }

    return content || originalText;
  } catch (e) {
    console.error("Text refinement failed", e);
    throw e;
  }
};

export const refineImagePrompt = async (
  originalPrompt: string,
  instruction: string,
  style: string,
  character: CharacterProfile,
  storyMode: string,
  onUsage?: (stat: UsageStat) => void
): Promise<string> => {
  const ai = getAi();

  const systemPrompt = `
    Role: Expert Image Prompt Engineer for ${getTheme().strings.brandTitleLead}${getTheme().strings.brandTitleAccent}.

    Task: Refine an existing image generation prompt based on user instructions, while strictly maintaining the comic's continuity, style, and required format.

    Context:
    - Master Art Style: "${style}"
    - Main Character: ${character.name} (${character.description})
    - Story Mode: ${storyMode}
    - Universe/World: ${character.name}'s Canon Universe (Strict Adherence)

    Input Prompt:
    """
    ${originalPrompt}
    """

    User Instruction for Modification:
    """
    ${instruction}
    """

    CRITICAL RULES:
    1. **Preserve Format**: You MUST return the result in the exact same structure. If the prompt contains a [VISUAL STATE] block, YOU MUST KEEP IT (you can modify its content, but not the syntax).
    2. **Preserve Continuity**: Do not change the characters' base designs or the global art style unless explicitly asked to "change the style".
    3. **Text Purity**: If the prompt contains Chinese dialogue like "text: '...'", DO NOT translate, remove, or alter the Chinese text unless the user specifically asks to change the dialogue.
    4. **Apply Changes**: Intelligently modify the visual descriptions in the [VISUAL STATE] block or the panel descriptions to satisfy the User Instruction.

    Output:
    Return ONLY the updated prompt text. Do not add markdown formatting, quotes, or explanations.
  `;

  const epoch = scope.epoch();

  try {
    const result = await ai.call({
      ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
      messages: [{ role: 'user', content: systemPrompt }],
      ...NO_TOOLS
    });

    throwIfAborted(epoch);

    const text = typeof result?.content === 'string' ? result.content : '';

    if (onUsage) {
      const u = result?.usage;
      if (typeof u?.inputTokens === 'number' && typeof u?.outputTokens === 'number') {
        onUsage(textStat(u.inputTokens, u.outputTokens, false));
      } else {
        const est = await estimateTextUsage(activeModels.textModel || undefined, systemPrompt, text);
        onUsage(textStat(est.inputTokens, est.outputTokens, true));
      }
    }

    if (!text) throw new Error("Empty response from AI");
    return text.trim();
  } catch (error) {
    console.error("Prompt refinement failed:", error);
    throw error;
  }
};

// JSON schema 的文字版描述（跨 Provider 兼容；原实现依赖 Gemini responseSchema）
const getJsonSchemaString = () => `
    ================================================================
    OUTPUT SCHEMA (STRICT JSON)
    ================================================================
    You MUST respond with a single valid JSON object (no markdown fences, no preamble).

    Structure:
    {
      "analysis": "String (Brief analysis of the source material's nature and adaptation strategy)",
      "title": "String (Comic Title in Chinese)",
      "global_art_style": "String (Detailed art style description. DO NOT INCLUDE CHARACTERS)",
      "character_sheet": [
         { "name": "String", "description": "String (MUST start with 'From [Universe Name]', e.g. From Doraemon...)" }
      ],
      "prop_sheet": [
         { "name": "String", "description": "String (important items, weapons, or objects that appear multiple times)" }
      ],
      "scene_sheet": [
         { "name": "String", "description": "String (1-4 key locations; fixed furnishings/layout and lighting mood, NO characters)" }
      ],
      "cover_image_prompt": "String",
      "pages": [
         {
           "page_number": Integer,
           "characters_in_scene": ["String"],
           "props_in_scene": ["String"],
           "scenes_in_scene": ["String"],
           "layout_description": "String",
           "persistent_states": {
              "characters": [
                {
                   "name": "String",
                   "state": {
                      "position": "String",
                      "pose": "String",
                      "appearance_changes": ["String"],
                      "injuries": ["String"]
                   }
                }
              ],
              "environment": {
                 "lighting": "String",
                 "notable_changes": ["String"]
              }
           },
           "state_changes_this_page": ["String"],
           "image_prompt": "String (Full page visual description starting with a [VISUAL STATE] block)"
         }
      ]
    }

    ALL fields above are REQUIRED.
`;

// ================= 剧本 JSON 可靠性（方案 4.6） =================
// API 级结构化输出约束（responseFormat: 'json_schema'）。文字版 getJsonSchemaString()
// 保留在静态 system 段作跨 provider 兜底（Anthropic 原生端点宿主暂不注入 schema）。
// strict 必须显式 false：宿主默认 true，复杂嵌套 schema 在 OpenAI strict 模式下会被拒。
const COMIC_JSON_SCHEMA = {
  type: 'object',
  required: ['analysis', 'title', 'global_art_style', 'character_sheet',
             'prop_sheet', 'scene_sheet', 'cover_image_prompt', 'pages'],
  properties: {
    analysis: { type: 'string' },
    title: { type: 'string' },
    global_art_style: { type: 'string' },
    character_sheet: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description'],
        properties: { name: { type: 'string' }, description: { type: 'string' } },
      },
    },
    prop_sheet: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description'],
        properties: { name: { type: 'string' }, description: { type: 'string' } },
      },
    },
    scene_sheet: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description'],
        properties: { name: { type: 'string' }, description: { type: 'string' } },
      },
    },
    cover_image_prompt: { type: 'string' },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['page_number', 'characters_in_scene', 'props_in_scene',
                   'layout_description', 'persistent_states',
                   'state_changes_this_page', 'image_prompt'],
        properties: {
          page_number: { type: 'integer' },
          characters_in_scene: { type: 'array', items: { type: 'string' } },
          props_in_scene: { type: 'array', items: { type: 'string' } },
          scenes_in_scene: { type: 'array', items: { type: 'string' } },
          layout_description: { type: 'string' },
          persistent_states: {
            type: 'object',
            required: ['characters', 'environment'],
            properties: {
              characters: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'state'],
                  properties: {
                    name: { type: 'string' },
                    state: {
                      type: 'object',
                      properties: {
                        position: { type: 'string' },
                        pose: { type: 'string' },
                        appearance_changes: { type: 'array', items: { type: 'string' } },
                        injuries: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
              environment: {
                type: 'object',
                properties: {
                  lighting: { type: 'string' },
                  notable_changes: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
          state_changes_this_page: { type: 'array', items: { type: 'string' } },
          image_prompt: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * 解析容错三级递进（方案 4.6）：本地提取 → 一次自动修复重试（低成本非流式回喂）→ 保留原文抛错。
 * 修复调用不注册 requestId（不可中止），调用方在返回后须补一次纪元检查（D1）。
 */
const parseScriptWithRepair = async (
  raw: string,
  onUsage?: (stat: UsageStat) => void
): Promise<ComicResponse> => {
  try {
    return JSON.parse(extractJson(raw)) as ComicResponse;
  } catch (parseError) {
    // 自动重试一次：原文 + 错误信息回喂做修复（非流式）
    try {
      const fixed = await getAi().call({
        ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
        messages: [
          { role: 'system', content: 'You are a JSON repair tool. Return ONLY the corrected, complete JSON object. No markdown, no commentary.' },
          { role: 'user', content: `This text should be one JSON object but fails to parse (${String(parseError)}). Fix and return it:\n\n${raw}` },
        ],
        params: { responseFormat: 'json_object' },
        ...NO_TOOLS,
      });
      const fixedText = typeof fixed?.content === 'string' ? fixed.content : '';
      // 修复调用同样计费，记入 TokenMonitor（方案 5.2：如实上报模型与估算标记）
      if (onUsage) {
        const u = fixed?.usage;
        if (typeof u?.inputTokens === 'number' && typeof u?.outputTokens === 'number') {
          onUsage(textStat(u.inputTokens, u.outputTokens, false));
        } else {
          const est = await estimateTextUsage(activeModels.textModel || undefined, raw, fixedText);
          onUsage(textStat(est.inputTokens, est.outputTokens, true));
        }
      }
      return JSON.parse(extractJson(fixedText)) as ComicResponse;
    } catch {
      // 方案 5.4：可行动错误文案（不透传 "Unexpected token…"）
      const err = new Error('模型返回的剧本不是有效 JSON（已自动修复重试一次仍失败）。建议：① 直接重试；② 更换支持 JSON 输出的文本模型。原始输出已保留在右侧日志面板，可复制后手动修复重用。');
      (err as Error & { rawText?: string }).rawText = raw;
      throw err;
    }
  }
};

// ================= 剧本 systemPrompt 静态前缀（方案 4.5） =================
// system 段完全静态（按当前 theme 惰性构建一次并缓存，单插件内字节稳定），命中
// OpenAI/Gemini/DeepSeek 类隐式 prompt caching；全部变量（源文本 / castingPhase /
// 画风 / 页数 / 叙事指令）集中到 user 消息，且会话内稳定的 Source Material 放最前、
// 可调变量放最后。题材差异（Role 行 / 素材类型分析段）由 theme 注入。
let staticSystemPromptCache: { theme: MangaTheme; prompt: string } | null = null;

const getStaticSystemPrompt = (): string => {
  const theme = getTheme();
  if (staticSystemPromptCache?.theme === theme) return staticSystemPromptCache.prompt;
  // 题材可选的"故事架构"段（storyCraftRules）：插在 PHASE 3 注记与 PHASE 4 之间；
  // 缺省为空串，system prompt 与不填该字段的主题保持逐字节一致
  const craft = theme.storyCraftRules?.trim();
  const craftBlock = craft ? `${craft}\n\n` : '';
  const prompt = `
    Role: ${theme.systemRole}

    Target Art Style: Specified in the user message as "Target Art Style" (CRITICAL: All visual descriptions must match that style).

    Task: Adapt the provided Source Material into a suspenseful, engaging sequential Manga/Comic script.

    ================================================================
    PHASE 1: SOURCE MATERIAL ANALYSIS (INTERNAL)
    ================================================================
    Before writing the script, you must ANALYZE the 'Source Material' provided in the user message.
${theme.sourceAnalysis}

    ================================================================
    PHASE 2: UNIVERSE & WORLD IMMERSION
    ================================================================
    - **IMMERSION RULE**: The script MUST feel like a legitimate episode.
    - **LORE ADAPTATION**:
       - **IF** Technical/Sci-Fi: Use precise technical jargon.
       - **IF** Historical (Serious): Use period-accurate language and setting. No modern tech unless specified.
       - **IF** Historical (Parody): Mix historical setting with the character's modern quirks (anachronistic humor).

    (PHASE 3 casting rules are provided in the user message.)

${craftBlock}    ================================================================
    PHASE 4: DIALOGUE & NARRATIVE DENSITY (CRITICAL)
    ================================================================
    - **HIGH VERBOSITY REQUIRED**:
      - Do NOT write sparse or minimal dialogue.
      - **Explain Everything**: The characters must explain the concepts/events thoroughly through their conversation.
      - **Educational Goal**: The user must understand the metadata/principles/history purely by reading the dialogue.
    - **NO SUMMARIES**: NEVER write "He explains the algorithm." -> **WRITE THE ACTUAL EXPLANATION**.
    - **CHARACTER VOICE**:
      - Characters MUST speak exactly like they do in canon (or history).
    - **Language**: All dialogue must be in natural, high-quality **Simplified Chinese (简体中文)**.

    ================================================================
    PHASE 5: VISUAL CONTINUITY & CINEMATOGRAPHY (CRITICAL)
    ================================================================
    - **NO TELEPORTATION**: Characters cannot jump locations instantly.
    - **PANEL-TO-PANEL FLOW**:
      - The 'image_prompt' must describe a FLUID sequence.
      - **Action Continuity**: If Panel 1 is "Character raises hand", Panel 2 MUST be "Hand slams on table".

    ================================================================
    PHASE 6: LENGTH & STRUCTURE
    ================================================================
    - Follow the "Total Pages" and "Panels per Page" constraints specified in the user message.

    ================================================================
    PHASE 7: VISUALS, CHARACTERS & PROPS
    ================================================================
    **Dynamic Asset Design**:
    1. **Characters**: Identify the Protagonist, Sidekicks, and Antagonists. Create a 'character_sheet'.
       - **DESCRIPTION FORMAT**: "**[Character Name]**. [Visual Details...]"

    2. **Props/Items**: Identify KEY OBJECTS or WEAPONS that appear frequently.
       - Create a 'prop_sheet'.

    3. **Scenes/Locations**: Identify 1-4 KEY LOCATIONS where the story mainly takes place.
       - Create a 'scene_sheet'.
       - **DESCRIPTION FORMAT**: Fixed furnishings/layout and lighting mood (NO characters).
       - Every page MUST list the locations it takes place in ('scenes_in_scene', names from 'scene_sheet').
       - Backgrounds of the same location MUST match its scene reference across pages.

    **Naming Discipline (STRICT)**:
    - 'characters_in_scene', 'props_in_scene' and 'scenes_in_scene' MUST use the EXACT names from the corresponding sheets, character-by-character (逐字一致).
    - NEVER invent variant names in these lists (no role/status suffixes like "Name (role)"). A character's situation or disguise belongs in 'image_prompt' and 'persistent_states', NOT in the name.
    - Each list MUST be a subset of its sheet. If a page needs a new prop or location, add it to 'prop_sheet'/'scene_sheet' FIRST, then reference its exact name.

    **Page Layout Enforcement**:
    - The 'image_prompt' MUST describe the **FULL PAGE LAYOUT**.
    - **MANDATORY STATE PREAMBLE**: Every image_prompt MUST begin with a "[VISUAL STATE]" block.

    **Art Style Consistency**:
    - The 'global_art_style' field in JSON must describe the Target Art Style (specified in the user message) in detail.

    **Spatial Anchoring & Text Embedding (STRICT)**:
    - **Mandatory Format**: "Includes speech bubble located [POSITION] pointing to [CHARACTER] with text: '[CHINESE DIALOGUE]'"
    - **NO SPEAKER PREFIX**: Do NOT include "Name:" inside the quote.
    - **NO TRANSLATIONS**: Do NOT include English translation.

    ${getJsonSchemaString()}
`;
  staticSystemPromptCache = { theme, prompt };
  return prompt;
};

/**
 * Phase 2 可选维度（结局 / 主副模式混合；features 开关关闭时调用方恒传 undefined，
 * 输出 prompt 与 Phase 1 逐字节一致）。注入文案以 horror-manga 现有实现为准。
 */
export interface ScriptExtras {
  secondaryStoryMode?: StoryMode;
  endingType?: string;
  colorMode?: string;
  autoReview?: boolean; // false 时跳过生成后的自动审校 pass（默认审校）
}

/**
 * 剧本 user 消息构造（方案 5.2 步骤 6 抽出）：generateComicScript 与
 * estimateScriptTokens（pre-flight 预估）共用同一函数，保证预估与实发一致。
 */
const buildScriptUserPrompt = (
  text: string,
  style: string,
  character: CharacterProfile,
  storyMode: StoryMode,
  customStoryPrompt: string | undefined,
  panelCount: number,
  totalPages: string, // "Short", "Medium", "Long"
  extras: ScriptExtras = {}
): string => {
  // Instruction for panel density per page
  const panelsPerPage = panelCount > 0 ? `Exactly ${panelCount} panels per page` : "Auto-determined (3 to 6 panels)";

  // Determine Page Count constraints
  let pageCountInstruction = "";
  if (totalPages === 'Medium') {
    pageCountInstruction = "Total Pages: 6 to 10 pages.";
  } else if (totalPages === 'Long') {
    pageCountInstruction = "Total Pages: 11 to 15 pages. DO NOT EXCEED 15 PAGES.";
  } else {
    pageCountInstruction = "Total Pages: 3 to 5 pages.";
  }

  // Select Narrative Instructions based on Story Mode（叙事模板来自 theme.storyModes）
  const storyModePrompt = (mode: StoryMode) => getTheme().storyModes.find(m => m.value === mode)?.prompt;
  let narrativeTemplate = storyModePrompt(storyMode) || storyModePrompt(StoryMode.CONFLICT) || '';

  // Handle Custom Story Mode
  if (storyMode === StoryMode.CUSTOM && customStoryPrompt) {
     narrativeTemplate = (storyModePrompt(StoryMode.CUSTOM) || '').replace(/\$\{customPrompt\}/g, customStoryPrompt);
  }

  // Inject character details into the template
  const specificNarrativeInstructions = narrativeTemplate
    .replace(/\$\{character\.name\}/g, character.name)
    .replace(/\$\{character\.description\}/g, character.description);

  // Phase 2：主/副故事模式混合（features.secondaryStoryMode 开启时生效）——
  // 混合规则模板在核心包（与 horror-manga 现有文案一致），题材示例句由 theme.secondaryModeBlendExample 注入
  let narrativeBody = specificNarrativeInstructions;
  const theme = getTheme();
  if (theme.features.secondaryStoryMode) {
    narrativeBody = `**PRIMARY GENRE: ${storyMode}**\n${narrativeBody}`;
    const { secondaryStoryMode } = extras;
    if (secondaryStoryMode && secondaryStoryMode !== storyMode) {
      narrativeBody += `\n\n**SECONDARY GENRE (CROSS-OVER BLEND): ${secondaryStoryMode}**\n${storyModePrompt(secondaryStoryMode) || ''}`;
      narrativeBody += `\n\n**CROSS-OVER INSTRUCTION**: You must blend the themes of the Primary Genre with the tropes of the Secondary Genre.`;
      if (theme.secondaryModeBlendExample) narrativeBody += ` For example, ${theme.secondaryModeBlendExample}.`;
    }
  }

  // Phase 2：结局类型约束（features.endings 开启时生效；注入文案与 horror-manga 现有实现一致）
  if (theme.features.endings && extras.endingType) {
    narrativeBody += `\n\n**MANDATORY ENDING TYPE: ${extras.endingType}**\nThe story MUST conclude with this specific type of ending. Structure the plot to arrive at this point naturally.`;
  }

  // --- LOGIC FOR CASTING RULE CHANGE ---
  // If StoryMode.HISTORY_SERIOUS, we change strict canonical rules to "Historical Accuracy" rules.
  let castingPhase = "";

  if (storyMode === StoryMode.HISTORY_SERIOUS) {
     castingPhase = `
    ================================================================
    PHASE 3: HISTORICAL CASTING (AUTO-DETECT)
    ================================================================
    - **IGNORE INPUT CHARACTER**: The user input character "${character.name}" is a placeholder. IGNORE IT.
    - **DETECT FIGURES**: Scan the 'Source Material' for REAL historical figures (e.g. Napoleon, Cao Cao, Lincoln).
    - **CHARACTER SHEET GENERATION**:
      - Create entries in 'character_sheet' for these real figures.
      - Description MUST be historically accurate (e.g. "Napoleon: Wearing 19th-century French general uniform, bicorne hat, hand in coat").
      - DO NOT use anime tropes. Use realistic/period-correct descriptions.
     `;
  } else if (storyMode === StoryMode.HISTORY_PARODY) {
      castingPhase = `
    ================================================================
    PHASE 3: PARODY CASTING (COSPLAY/ROLEPLAY)
    ================================================================
    - **ROLEPLAY**: The Main Character "${character.name}" is CAST AS the main historical figure.
    - **VISUALS**: Describe "${character.name}" wearing the costume of the historical figure.
      - *Example*: "Pikachu wearing a Napoleon hat and coat".
    - **SUPPORTING CAST**: Use other characters from "${character.name}"'s universe to play other historical roles.
      - *Example*: "Ash Ketchum as the Duke of Wellington".
      `;
  } else {
      castingPhase = `
    ================================================================
    PHASE 3: STRICT CANONICAL CASTING & NAMING
    ================================================================
    - **UNIVERSE RULE**: All side characters MUST exist in the same official universe as the Main Character (${character.name}).
    - **NAMING RULE**: You MUST use the OFFICIAL, ORIGINAL NAMES found in the source material (Anime/Manga/Movie).
      - If Main Character is **Doraemon**: You MUST use **Nobita (大雄)**, **Shizuka (静香)**, **Gian (胖虎)**, **Suneo (小夫)**.
      - **FORBIDDEN**: Do NOT invent new characters or use generic names like "Student A" or "The Boss".
      `;
  }

  // 方案 4.5：system 完全静态（按 theme 惰性构建一次并缓存，见 getStaticSystemPrompt），变量集中到 user 消息；
  // 会话内稳定的 Source Material 放最前（调 style/页数不使源文本段的缓存前缀失效），可调变量放最后。
  return [
    `Source Material:\n"""\n${text}\n"""`,
    castingPhase,
    `Target Art Style: "${style}"`,
    pageCountInstruction,
    `Panels per Page: ${panelsPerPage}.`,
    `Directives for Plot & Narrative (Style Lens):\n${narrativeBody}`,
  ].join('\n\n');
};

/**
 * 剧本 system/user 消息解析（generateComicScript 与 estimateScriptTokens 共用）：
 * theme.buildScriptPrompt 钩子优先（题材可整体自定义 prompt 结构），
 * 否则核心包默认构造（静态 system 前缀 + 变量 user 消息，利于 prompt caching）。
 */
const resolveScriptPrompts = (
  text: string,
  style: string,
  character: CharacterProfile,
  storyMode: StoryMode,
  customStoryPrompt: string | undefined,
  panelCount: number,
  totalPages: string,
  extras: ScriptExtras
): { system: string; user: string } => {
  const theme = getTheme();
  const custom = theme.buildScriptPrompt?.({
    sourceText: text,
    style,
    character,
    storyMode,
    secondaryStoryMode: extras.secondaryStoryMode,
    endingType: extras.endingType,
    customStoryPrompt,
    panelCount,
    totalPages,
    colorMode: extras.colorMode,
  });
  if (custom) return custom;
  return {
    system: getStaticSystemPrompt(),
    user: buildScriptUserPrompt(text, style, character, storyMode, customStoryPrompt, panelCount, totalPages, extras),
  };
};

/**
 * Pre-flight 输入 token 预估（方案 5.2 步骤 6）：宿主 tokens.estimate 不可用返回 null（UI 隐藏）。
 * 消息构造与 generateComicScript 实发完全一致（同一 buildScriptUserPrompt + getStaticSystemPrompt()）。
 */
export const estimateScriptTokens = async (input: {
  sourceText: string;
  style: string;
  character: CharacterProfile;
  storyMode: StoryMode;
  customStoryPrompt?: string;
  panelCount: number;
  totalPages: string;
  secondaryStoryMode?: StoryMode;
  endingType?: string;
  colorMode?: string;
}): Promise<number | null> => {
  const ai = (window as Window).mulby?.ai;
  const est = (ai as { tokens?: { estimate?: Function } } | undefined)?.tokens?.estimate;
  if (typeof est !== 'function' || !input.sourceText.trim()) return null;
  try {
    const { system, user } = resolveScriptPrompts(
      input.sourceText, input.style, input.character, input.storyMode,
      input.customStoryPrompt, input.panelCount, input.totalPages,
      { secondaryStoryMode: input.secondaryStoryMode, endingType: input.endingType, colorMode: input.colorMode }
    );
    const r = await est({
      ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return typeof r?.inputTokens === 'number' ? r.inputTokens : null;
  } catch {
    return null;
  }
};

// 部分 provider（如 DeepSeek）不支持 json_schema response_format，报 HTTP 400
// "This response_format type is unavailable now"。识别后去掉结构化约束重试一次：
// prompt 的 JSON 指令 + 本地提取 + parseScriptWithRepair 修复链本就按无约束输出设计。
const isResponseFormatUnsupported = (e: unknown): boolean => {
  const msg = String((e as any)?.message ?? e ?? '');
  return /response[_-]?format/i.test(msg) && /400|unavailable|unsupported|invalid/i.test(msg);
};

export const generateComicScript = async (
  text: string,
  style: string,
  character: CharacterProfile,
  storyMode: StoryMode,
  customStoryPrompt: string | undefined,
  panelCount: number,
  totalPages: string, // "Short", "Medium", "Long"
  onLogUpdate: LogUpdateFn,
  onUsage?: (stat: UsageStat) => void,
  extras: ScriptExtras = {}
): Promise<ComicResponse> => {
  const ai = getAi();
  const { system: systemPrompt, user: userPrompt } = resolveScriptPrompts(
    text, style, character, storyMode, customStoryPrompt, panelCount, totalPages, extras
  );

  // 相位徽标：主创作 pass（后续自动审校 pass 由 reviewAndReviseScript 切到「审校」）
  onLogUpdate('PHASE', getTheme().strings.phaseScript);
  // Log the input prompt immediately（system + user 拼接，日志观感不变）
  const fullInputText = `${systemPrompt}\n\n${userPrompt}`;
  onLogUpdate('INPUT', fullInputText);

  const epoch = scope.epoch();

  const attempt = async (withSchema: boolean): Promise<string> => {
    let fullText = '';
    let fullReasoning = '';
    let streamError: string | null = null;
    let requestId: string | null = null;

    try {
      const req = ai.call(
        {
          ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          // 方案 4.6：API 级 jsonSchema 约束；strict 显式 false（宿主默认 true 会拒复杂嵌套 schema）。
          // theme.jsonSchema 可整体覆写（配合 buildScriptPrompt 钩子）。
          // 温度：AiModelParameters 支持 temperature——剧本生成 0.9 保创造性
          params: {
            temperature: 0.9,
            ...(withSchema ? {
              responseFormat: 'json_schema' as const,
              jsonSchema: (getTheme().jsonSchema ?? COMIC_JSON_SCHEMA) as unknown as Record<string, unknown>,
              jsonSchemaName: 'comic_script',
              strict: false,
            } : {}),
          },
          ...NO_TOOLS
        },
        (chunk: any) => {
          if (chunk.__requestId) {
            requestId = chunk.__requestId;
            if (!scope.trackIfCurrent(epoch, chunk.__requestId)) {
              // 捕获到 requestId 时已被中止：立即杀掉请求
              safeAbort(ai, chunk.__requestId);
            }
            return;
          }
          if (!scope.isCurrent(epoch)) return; // 已中止：忽略后续 chunk
          if (chunk.chunkType === 'text' && typeof chunk.content === 'string') {
            fullText += chunk.content;
            onLogUpdate('OUTPUT', fullText);
          } else if (chunk.chunkType === 'reasoning' && typeof chunk.reasoning_content === 'string') {
            // 推理模型思考流：非推理模型/老宿主永不发该 chunk，功能零回归
            fullReasoning += chunk.reasoning_content;
            onLogUpdate('REASONING', fullReasoning);
          } else if (chunk.chunkType === 'error' && chunk.error?.message) {
            streamError = chunk.error.message;
          }
        }
      );

      const finalMsg = await req;

      throwIfAborted(epoch);

      // 非流式兜底：部分 provider 直接返回完整内容
      if (!fullText && typeof finalMsg?.content === 'string') {
        fullText = finalMsg.content;
        if (fullText) onLogUpdate('OUTPUT', fullText);
      }

      if (onUsage) {
        const u = finalMsg?.usage;
        if (typeof u?.inputTokens === 'number' && typeof u?.outputTokens === 'number') {
          onUsage(textStat(u.inputTokens, u.outputTokens, false));
        } else {
          const est = await estimateTextUsage(activeModels.textModel || undefined, fullInputText, fullText);
          onUsage(textStat(est.inputTokens, est.outputTokens, true));
        }
      }

      if (!fullText) {
        throw new Error(streamError ? `AI 调用失败：${streamError}` : "No response from AI");
      }
      return fullText;

    } finally {
      if (requestId) scope.untrack(requestId);
    }
  };

  try {
    let fullText: string;
    try {
      fullText = await attempt(true);
    } catch (e) {
      if (!scope.isCurrent(epoch)) throw ABORT_ERROR();
      if (!isResponseFormatUnsupported(e)) throw e;
      console.warn('[script] provider 不支持 json_schema response_format，回退为无结构化约束重试:', e);
      fullText = await attempt(false);
    }

    // 方案 4.6：本地提取 → 修复重试一次 → 保留原文抛错；修复调用耗时较长，返回后补一次纪元检查
    const parsed = await parseScriptWithRepair(fullText, onUsage);
    throwIfAborted(epoch);
    // 方案 2.3：不信任模型输出的 page_number，按数组序归一化（封面固定 0，正文 1..N）
    parsed.pages = (parsed.pages ?? []).map((p, i) => ({ ...p, page_number: i + 1 }));

    // B：名单归一化（变体吸附 sheet 原名 / 未匹配道具场景自动补表 / 未匹配角色报告）——
    // 在审校与快照落盘之前生效，保证持久化的是归一化后的数据
    const normalized = normalizeSceneLists(parsed);
    const normalizeLog = summarizeNormalizeReport(normalized.report);
    const finalScript = normalized.script;

    // C：剧本自动审校 pass（autoReview 默认开；失败静默用原稿不阻断流程；用户中止按纪元收敛）
    if (extras.autoReview !== false) {
      try {
        const { script: reviewed, notes } = await reviewAndReviseScript(finalScript, { epoch, onLogUpdate, onUsage });
        throwIfAborted(epoch);
        const suffix =
          (normalizeLog ? `\n\n===== NAME NORMALIZATION =====\n${normalizeLog}` : '') +
          (notes ? `\n\n===== REVIEW NOTES =====\n${notes}` : '');
        if (suffix) onLogUpdate('OUTPUT', `${fullText}${suffix}`);
        return reviewed;
      } catch (e) {
        if (!scope.isCurrent(epoch)) throw ABORT_ERROR(); // 审校中被中止：按中止收敛
        console.warn('[script] 自动审校失败，静默使用原稿:', e);
      }
    }
    if (normalizeLog) onLogUpdate('OUTPUT', `${fullText}\n\n===== NAME NORMALIZATION =====\n${normalizeLog}`);
    return finalScript;

  } catch (error) {
    // 方案 2.5："是否用户中止"由 epoch 权威判定，不再猜错误文本（含 'abort' 的网关错误应正常上报 UI）
    if (!scope.isCurrent(epoch)) throw ABORT_ERROR();            // 本轮已被用户中止：按中止收敛
    if ((error as any)?.name === 'AbortError') throw error;   // 本地抛出的原生中止（防御性保留）
    console.error("Script generation failed:", error);
    throw error;                                              // 真实失败：原样上报 UI
  }
};

// ================= C/D：结构化文本 JSON 调用（审校 / 意见迭代共用） =================
// 与 generateComicScript 同款链路：json_schema 约束（不支持时回退无约束）+ 流式 +
// 纪元中止 + usage 如实上报。epoch 由调用方传入（沿用其运行代际），缺省捕获新纪元。

interface TextJsonCallArgs {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  jsonSchemaName: string;
  temperature: number;
  epoch?: number;
  onLogUpdate?: LogUpdateFn;
  onUsage?: (stat: UsageStat) => void;
}

const callTextJson = async ({
  system, user, jsonSchema, jsonSchemaName, temperature, epoch: epochArg, onLogUpdate, onUsage,
}: TextJsonCallArgs): Promise<string> => {
  const ai = getAi();
  const epoch = epochArg ?? scope.epoch();
  const fullInputText = `${system}\n\n${user}`;
  onLogUpdate?.('INPUT', fullInputText);

  const attempt = async (withSchema: boolean): Promise<string> => {
    let fullText = '';
    let fullReasoning = '';
    let streamError: string | null = null;
    let requestId: string | null = null;

    try {
      const req = ai.call(
        {
          ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          params: {
            temperature,
            ...(withSchema ? {
              responseFormat: 'json_schema' as const,
              jsonSchema,
              jsonSchemaName,
              strict: false,
            } : {}),
          },
          ...NO_TOOLS
        },
        (chunk: any) => {
          if (chunk.__requestId) {
            requestId = chunk.__requestId;
            if (!scope.trackIfCurrent(epoch, chunk.__requestId)) {
              safeAbort(ai, chunk.__requestId);
            }
            return;
          }
          if (!scope.isCurrent(epoch)) return;
          if (chunk.chunkType === 'text' && typeof chunk.content === 'string') {
            fullText += chunk.content;
            onLogUpdate?.('OUTPUT', fullText);
          } else if (chunk.chunkType === 'reasoning' && typeof chunk.reasoning_content === 'string') {
            fullReasoning += chunk.reasoning_content;
            onLogUpdate?.('REASONING', fullReasoning);
          } else if (chunk.chunkType === 'error' && chunk.error?.message) {
            streamError = chunk.error.message;
          }
        }
      );

      const finalMsg = await req;

      throwIfAborted(epoch);

      if (!fullText && typeof finalMsg?.content === 'string') {
        fullText = finalMsg.content;
        if (fullText) onLogUpdate?.('OUTPUT', fullText);
      }

      if (onUsage) {
        const u = finalMsg?.usage;
        if (typeof u?.inputTokens === 'number' && typeof u?.outputTokens === 'number') {
          onUsage(textStat(u.inputTokens, u.outputTokens, false));
        } else {
          const est = await estimateTextUsage(activeModels.textModel || undefined, fullInputText, fullText);
          onUsage(textStat(est.inputTokens, est.outputTokens, true));
        }
      }

      if (!fullText) {
        throw new Error(streamError ? `AI 调用失败：${streamError}` : "No response from AI");
      }
      return fullText;

    } finally {
      if (requestId) scope.untrack(requestId);
    }
  };

  try {
    return await attempt(true);
  } catch (e) {
    if (!scope.isCurrent(epoch)) throw ABORT_ERROR();
    if (!isResponseFormatUnsupported(e)) throw e;
    console.warn('[text-json] provider 不支持 json_schema response_format，回退为无结构化约束重试:', e);
    return await attempt(false);
  }
};

// ================= C：剧本自动审校 pass（总编辑 checklist；题材中性） =================

const REVIEW_SYSTEM_PROMPT = `
    Role: Editor-in-Chief of a manga editorial department.

    Task: Review the provided comic script JSON against the checklist below, then return the REVISED script together with your review notes.

    REVIEW CHECKLIST:
    1. **Logic Gaps / Causality Breaks**: Every event must have a cause established earlier. Fix outcomes that come out of nowhere.
    2. **Character Motivation**: Each main character's key actions must have a clear, understandable motive. Fix unmotivated behavior.
    3. **Setup & Payoff**: Foreshadowed elements (objects, lines, mysteries) must be paid off by the end. Resolve or remove dangling setups.
    4. **Ending Consistency**: The final pages must deliver the ending the story promises. Fix conclusions that feel detached from the buildup.
    5. **Narration Overload**: Narration boxes must not over-explain what the visuals and dialogue already convey. Trim redundant narration; merge or delete narration that repeats the obvious.
    6. **Page-to-Page Continuity**: Page N+1 must directly continue Page N — no teleporting, no repeated panels, no contradictions in state or position.
    7. **Sheet Consistency**: Names in 'characters_in_scene', 'props_in_scene', and 'scenes_in_scene' must exist in 'character_sheet', 'prop_sheet', and 'scene_sheet' respectively. Variant names (aliases, role/status suffixes like "Name (role)") MUST be merged back to the sheet's exact name. Add missing sheet entries or fix the page lists.

    RULES:
    - Fix ONLY the problems listed above. Do NOT change the core premise, the cast, the art style, the tone, or the page count.
    - Keep all dialogue and narration in their original language (Simplified Chinese unless the script says otherwise).
    - Keep the exact same JSON structure and field names as the input script.
    - Keep 'character_sheet', 'prop_sheet', and 'scene_sheet' entries unless a fix requires changing them.

    Output: Return a single valid JSON object (no markdown, no commentary) with EXACTLY this shape:
    { "notes": "String (concise review notes: what was wrong and what you changed)",
      "script": { ...the complete revised script JSON, same structure as the input... } }
`;

/** 审校输出包装 schema（script 部分用题材自己的剧本 schema） */
const getReviewWrapperSchema = (): Record<string, unknown> => ({
  type: 'object',
  required: ['notes', 'script'],
  properties: {
    notes: { type: 'string' },
    script: (getTheme().jsonSchema ?? COMIC_JSON_SCHEMA) as unknown as Record<string, unknown>,
  },
});

export interface ScriptReviewResult {
  script: ComicResponse;
  notes: string;
}

/**
 * 剧本自动审校：发给文本模型扮演总编辑按 checklist 审校并返回修订后的完整 JSON。
 * 温度 0.3（审校要稳）；page_number 按数组序归一化后返回。
 */
export const reviewAndReviseScript = async (
  script: ComicResponse,
  opts?: {
    epoch?: number;
    onLogUpdate?: LogUpdateFn;
    onUsage?: (stat: UsageStat) => void;
  }
): Promise<ScriptReviewResult> => {
  const epoch = opts?.epoch ?? scope.epoch();
  const userPrompt = `SCRIPT TO REVIEW (JSON):\n"""\n${JSON.stringify(script)}\n"""`;

  // 相位徽标切到「审校」：消费方据此重置思考/输出，避免主创作 pass 的内容与审校 pass 混在一起
  opts?.onLogUpdate?.('PHASE', getTheme().strings.phaseReview);

  const raw = await callTextJson({
    system: REVIEW_SYSTEM_PROMPT,
    user: userPrompt,
    jsonSchema: getReviewWrapperSchema(),
    jsonSchemaName: 'comic_script_review',
    temperature: 0.3,
    epoch,
    onLogUpdate: opts?.onLogUpdate,
    onUsage: opts?.onUsage,
  });

  // 复用三级解析链（本地提取 → 修复重试一次 → 抛错）；修复结果同样按包装形状解读
  const parsed = await parseScriptWithRepair(raw, opts?.onUsage) as unknown as {
    notes?: unknown;
    script?: ComicResponse;
  };
  throwIfAborted(epoch);

  const revised = parsed?.script;
  if (!revised || !Array.isArray(revised.pages)) {
    throw new Error('审校返回的剧本结构不完整');
  }
  revised.pages = revised.pages.map((p, i) => ({ ...p, page_number: i + 1 }));

  // B：审校稿同样过名单归一化；变更摘要附进 notes
  const norm = normalizeSceneLists(revised);
  const normLog = summarizeNormalizeReport(norm.report);
  const baseNotes = typeof parsed.notes === 'string' ? parsed.notes.trim() : '';

  return { script: norm.script, notes: baseNotes + (normLog ? `\n[Name normalization]\n${normLog}` : '') };
};

// ================= D：剧本意见迭代（现剧本 + 用户意见 → 修订版完整 JSON） =================

const REVISE_FEEDBACK_SYSTEM_PROMPT = `
    Role: Editor-in-Chief of a manga editorial department.

    Task: Revise the provided comic script JSON according to the USER FEEDBACK, then return the complete revised script.

    RULES:
    - Apply the feedback precisely. Keep ALL unaffected pages, layouts, image prompts, character/prop/scene sheets, and descriptions unchanged wherever possible.
    - Do NOT change the core premise, the art style, the tone, or the page count.
    - Keep all dialogue and narration in their original language (Simplified Chinese unless the script says otherwise).
    - Keep the exact same JSON structure and field names as the input script.

    Output: Return the COMPLETE revised script as a single valid JSON object (no markdown, no commentary).
`;

/**
 * 剧本意见迭代：现剧本 + 用户意见 → 修订版完整 JSON（温度 0.3 的受控修订）。
 * page_number 按数组序归一化后返回；解析失败经修复链重试一次后抛错。
 */
export const reviseScriptWithFeedback = async (
  script: ComicResponse,
  feedback: string,
  opts?: {
    epoch?: number;
    onLogUpdate?: LogUpdateFn;
    onUsage?: (stat: UsageStat) => void;
  }
): Promise<ComicResponse> => {
  const epoch = opts?.epoch ?? scope.epoch();
  const userPrompt = `CURRENT SCRIPT (JSON):\n"""\n${JSON.stringify(script)}\n"""\n\nUSER FEEDBACK:\n"${feedback}"`;

  const raw = await callTextJson({
    system: REVISE_FEEDBACK_SYSTEM_PROMPT,
    user: userPrompt,
    jsonSchema: (getTheme().jsonSchema ?? COMIC_JSON_SCHEMA) as unknown as Record<string, unknown>,
    jsonSchemaName: 'comic_script',
    temperature: 0.3,
    epoch,
    onLogUpdate: opts?.onLogUpdate,
    onUsage: opts?.onUsage,
  });

  const parsed = await parseScriptWithRepair(raw, opts?.onUsage);
  throwIfAborted(epoch);
  parsed.pages = (parsed.pages ?? []).map((p, i) => ({ ...p, page_number: i + 1 }));

  // B：迭代稿同样过名单归一化（摘要写日志与 LogPanel）
  const norm = normalizeSceneLists(parsed);
  const normLog = summarizeNormalizeReport(norm.report);
  if (normLog) {
    console.warn('[revise] name normalization:\n' + normLog);
    opts?.onLogUpdate?.('OUTPUT', `${raw}\n\n===== NAME NORMALIZATION =====\n${normLog}`);
  }
  return norm.script;
};

/**
 * Generates a character reference sheet (Image) based on the description and style.
 */
export const generateCharacterReference = async (
  name: string,
  description: string,
  style: string,
  onUsage?: (stat: UsageStat) => void,
  onProgress?: (p: ImageProgress) => void
): Promise<string> => {
  const ai = getAi();
  const model = await resolveImageModel();

  // Construct a prompt that strongly enforces the OFFICIAL design.
  const prompt = `
    Subject: The character "${name}".
    Source Material Context: ${description}
    Target Art Style: ${style}

    CRITICAL INSTRUCTION - SOURCE MATERIAL IDENTITY:
    1. Read the "Source Material Context" above to identify the specific Anime, Manga, Comic, or Movie franchise (e.g., "From Doraemon", "From Marvel", "From Attack on Titan").
    2. You MUST draw the OFFICIAL, CANONICAL design of "${name}" from that specific franchise.
    3. Do NOT draw a generic character. If the context says "From Doraemon", you must draw the specific character design from Doraemon.
    4. **IF** the description is historical (e.g. Napoleon), draw the historical figure accurately based on paintings/statues.

    Visual Instructions:
    - A single character turnaround sheet on ONE canvas, white background.
    - Layout, left to right: (1) full-body front view, (2) full-body side view, (3) full-body back view, (4) face close-up front view, (5) face close-up side/profile view.
    - All five views depict the SAME character with identical face, hairstyle, body type and costume.
    - Standing neutral pose for the three full-body views.
    - **EXPRESSION**: Neutral, relaxed expression in ALL views — calm face, relaxed brows, closed mouth, no strong emotion. This is a reference sheet, not a scene.
    - High quality, detailed character sheet. Match the "Target Art Style".
    - **IDENTITY**: Keep the character's canonical facial features, body type, and hair recognizable.
    - **COSTUME**: If the 'Source Material Context' describes a specific costume (e.g. "wearing a spacesuit", "dressed as Napoleon"), you MUST draw them in that costume. Do NOT default to their standard anime outfit if a specific costume is requested.
    - **NO TEXT**: No labels, no annotations, no captions.
    - Output image aspect ratio: landscape 3:2.
  `.trim(); // hint 与 size 1536x1024（精确 3:2）一致，不谎报（方案 4.7）

  const epoch = scope.epoch();

  try {
    // 方案 5.3：无参考图路径走流式（真实进度 + 渐进预览；老宿主自动回落非流式）
    const result = await generateImageWithProgress(ai, {
      model,
      prompt,
      size: '1536x1024',
      count: 1
    }, epoch, onProgress);

    throwIfAborted(epoch);

    if (onUsage) onUsage(imageStat(model, result.tokens));

    const image = result.images?.[0];
    if (image) return toDataUrl(image);

    throw new Error("No image generated for character reference.");
  } catch (error) {
    // 与 2.5 同款 epoch 权威判定：中止后归一为 AbortError（供 withRetryOnce 排除、UI 静默收敛）
    if (!scope.isCurrent(epoch)) throw ABORT_ERROR();
    if ((error as any)?.name === 'AbortError') throw error;
    console.error("Character reference generation failed:", error);
    throw error;
  }
};

/**
 * Generates a PROP reference sheet (Image) based on the description and style.
 */
export const generatePropReference = async (
  name: string,
  description: string,
  style: string,
  mainCharacterName: string,
  storyMode: string,
  onUsage?: (stat: UsageStat) => void,
  onProgress?: (p: ImageProgress) => void
): Promise<string> => {
  const ai = getAi();
  const model = await resolveImageModel();

  // Determine universe instruction
  const universeInstruction = storyMode === 'history_serious'
     ? "This item is from a Historical Documentary. It must be strictly historically accurate to the era described."
     : `This item belongs to the fictional universe of "${mainCharacterName}". It must match the design aesthetic of that franchise (e.g. technology, magic, materials).`;

  const prompt = `
    Subject: Official Design of Item/Prop: ${name}.

    INPUT CONTEXT:
    1. **Function/Description**: ${description}
    2. **Universe Context**: ${universeInstruction}
    3. **Target Art Style**: ${style}

    INSTRUCTIONS:
    - **VISUAL STYLE**: You MUST draw the item using the "Target Art Style" defined above. If the style is "Manga", it must look like a Manga drawing, NOT a photo.
    - **DESIGN CONSISTENCY**: The item must look like it belongs in the "Universe Context" described above.
    - **COMPOSITION**: Multi-angle product reference sheet on ONE canvas: front view, side view, and three-quarter back view of the SAME item arranged in a row, white background, neutral lighting, consistent details across views.
    - **NO TEXT**: Do not include labels.
    - Output image aspect ratio: landscape 3:2.
  `.trim();

  const epoch = scope.epoch();

  try {
    // 方案 5.3：无参考图路径走流式（真实进度 + 渐进预览；老宿主自动回落非流式）
    const result = await generateImageWithProgress(ai, {
      model,
      prompt,
      size: '1536x1024',
      count: 1
    }, epoch, onProgress);

    throwIfAborted(epoch);

    if (onUsage) onUsage(imageStat(model, result.tokens));

    const image = result.images?.[0];
    if (image) return toDataUrl(image);

    throw new Error("No image generated for prop reference.");
  } catch (error) {
    // 与 2.5 同款 epoch 权威判定：中止后归一为 AbortError（供 withRetryOnce 排除、UI 静默收敛）
    if (!scope.isCurrent(epoch)) throw ABORT_ERROR();
    if ((error as any)?.name === 'AbortError') throw error;
    console.error("Prop reference generation failed:", error);
    throw error;
  }
};

/**
 * Generates a SCENE/LOCATION reference sheet (Image) based on the description and style.
 * 比照 generatePropReference：白底设定图、无角色、固定陈设与光线基调，跨页锁场景一致性。
 */
export const generateSceneReference = async (
  name: string,
  description: string,
  style: string,
  mainCharacterName: string,
  storyMode: string,
  onUsage?: (stat: UsageStat) => void,
  onProgress?: (p: ImageProgress) => void
): Promise<string> => {
  const ai = getAi();
  const model = await resolveImageModel();

  // Determine universe instruction（与道具参考图同一世界观判定口径）
  const universeInstruction = storyMode === 'history_serious'
     ? "This location is from a Historical Documentary. It must be strictly historically accurate to the era described."
     : `This location belongs to the fictional universe of "${mainCharacterName}". It must match the design aesthetic of that franchise.`;

  const prompt = `
    Subject: Official Design of Location/Scene: ${name}.

    INPUT CONTEXT:
    1. **Setting/Description**: ${description}
    2. **Universe Context**: ${universeInstruction}
    3. **Target Art Style**: ${style}

    INSTRUCTIONS:
    - **VISUAL STYLE**: You MUST draw the location using the "Target Art Style" defined above.
    - **DESIGN CONSISTENCY**: The location must look like it belongs in the "Universe Context" described above.
    - **COMPOSITION**: Wide establishing shot of the place. High quality environment concept art.
    - **NO CHARACTERS**: Empty scene only — no people, no creatures.
    - **FIXED DETAILS**: Emphasize fixed furnishings, layout, and lighting mood described above (these will anchor all future pages).
    - White or simple neutral background borders are acceptable, but the location itself must be fully readable.
    - Output image aspect ratio: square 1:1.
  `.trim();

  const epoch = scope.epoch();

  try {
    // 方案 5.3：无参考图路径走流式（真实进度 + 渐进预览；老宿主自动回落非流式）
    const result = await generateImageWithProgress(ai, {
      model,
      prompt,
      size: '1024x1024',
      count: 1
    }, epoch, onProgress);

    throwIfAborted(epoch);

    if (onUsage) onUsage(imageStat(model, result.tokens));

    const image = result.images?.[0];
    if (image) return toDataUrl(image);

    throw new Error("No image generated for scene reference.");
  } catch (error) {
    // 与 2.5 同款 epoch 权威判定：中止后归一为 AbortError（供 withRetryOnce 排除、UI 静默收敛）
    if (!scope.isCurrent(epoch)) throw ABORT_ERROR();
    if ((error as any)?.name === 'AbortError') throw error;
    console.error("Scene reference generation failed:", error);
    throw error;
  }
};

export const generatePanelImage = async (
  prompt: string,
  aspectRatio: string,
  referenceImages?: string[], // Optional array of base64 images
  onUsage?: (stat: UsageStat) => void,
  onProgress?: (p: ImageProgress) => void
): Promise<string> => {
  const ai = getAi();
  const model = await resolveImageModel();
  const { size, canvasHint, requestedHint } = aspectRatioToSize(aspectRatio);

  const hasRefs = !!(referenceImages && referenceImages.length > 0);
  let finalPrompt = prompt;

  if (hasRefs) {
     // UPDATED PROMPT STRATEGY:
     // Enforcing STRICT ADHERENCE to reference images and identity, ignoring conflicting text descriptions.
     finalPrompt = `
      VISUAL REFERENCES PROVIDED.

      INSTRUCTION FOR REFERENCES (IDENTITY VS ACTION):
      - **IDENTITY (STRICT)**: You MUST strictly maintain the character's Face, Hair, Body Type, and Costume/Clothing details EXACTLY as shown in the reference images.
      - **SCENE CONSISTENCY**: If scene reference images are provided, the background location MUST match them exactly (layout, furnishings, lighting mood).
      - **ACTION (DYNAMIC)**: **DO NOT COPY THE POSE** from the reference images. The reference images are static character sheets (mugshots).
      - **POSE INSTRUCTION**: You MUST make the character perform the ACTION described in the "TEXT PROMPT" below (e.g., running, fighting, typing, shouting). Make the pose dynamic and dramatic.
      - **EXPRESSION (DYNAMIC)**: Reference faces show a NEUTRAL expression by design. Do NOT copy it — the character's emotion/expression MUST follow the TEXT PROMPT (e.g., terrified, furious, smiling).

      INSTRUCTION FOR SCENE:
      - **ART STYLE ENFORCEMENT**: The image MUST be generated in the requested Art Style.
      - **SEQUENTIAL FLOW**: Ensure visual continuity between panels. If multiple panels are described, they must look like a continuous sequence, not random images.
      - Follow the TEXT PROMPT below for Action, Composition, and Background.

${getTheme().languageRules}

      TEXT PROMPT (SOURCE OF ACTION & COMPOSITION):
      ${prompt}

      ENSURE THE ART STYLE IS APPLIED HEAVILY.
     `;
  }

  // 方案 4.7：generate 路径用 canvasHint（与 size 画布数学一致，防留白/边框）；
  // edit 路径无固定画布，用 requestedHint 忠实用户所选比例（与随入参透传的 aspectRatio 一致）。
  finalPrompt = `${finalPrompt}\n\nOutput image aspect ratio: ${hasRefs ? requestedHint : canvasHint}.`;

  const refAttachmentIds: string[] = [];
  const epoch = scope.epoch();

  try {
    let result: { images: string[]; tokens: { inputTokens: number; outputTokens: number } };

    if (hasRefs) {
      // 带参考图：附件经模块级缓存复用（方案 4.1，同一张图整轮会话只上传一次），走 images.edit。
      // edit 无 stream 变体（方案 5.3）：给两段式真实进度——上传参考图 → 绘制中。
      onProgress?.({ stage: 'start', message: '上传参考图…' });
      for (const imgData of referenceImages!) {
        throwIfAborted(epoch);
        refAttachmentIds.push(await uploadRefCached(ai, imgData));
      }
      throwIfAborted(epoch);
      onProgress?.({ stage: 'partial', message: '绘制中…' });

      // 第 6 章对接：自生成 requestId 随 input 传入并登记进中止集合——新宿主
      // （feat/ai-image-abort-and-size）abortAllAiTasks 即可真杀在途 edit；
      // 老宿主对多余的 requestId/size/aspectRatio 字段安全忽略，自动退化为现状（D6，无显式探测）。
      const editRequestId = `${getTheme().id.replace(/-/g, '')}-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      scope.trackIfCurrent(epoch, editRequestId);
      try {
        result = await ai.images.edit({
          model,
          imageAttachmentId: refAttachmentIds[0],
          referenceAttachmentIds: refAttachmentIds.slice(1),
          prompt: finalPrompt,
          size,                       // 6.3：输出规格约束，对冲 edit 输出跟随首图分辨率
          aspectRatio,                // 用户所选比例（与 requestedHint 文案一致）
          requestId: editRequestId,
        });
      } finally {
        scope.untrack(editRequestId);
      }
    } else {
      // 方案 5.3：无参考图路径走流式（真实进度 + 渐进预览；老宿主自动回落非流式）
      result = await generateImageWithProgress(ai, {
        model,
        prompt: finalPrompt,
        size,
        count: 1
      }, epoch, onProgress);
    }

    throwIfAborted(epoch);

    // 方案 5.2：token 记宿主原始值（占位 0/16 不用于计价），计价在 App 层按张查价表
    if (onUsage) onUsage(imageStat(model, result.tokens));

    const image = result.images?.[0];
    if (image) return toDataUrl(image);

    throw new Error("No image data found in response");

  } catch (error) {
    // 与 2.5 同款 epoch 权威判定：中止后归一为 AbortError（供 withRetryOnce 排除、UI 静默收敛）。
    // 真被 ai.abort 杀掉的 edit 请求跨 IPC 后 name 恒为 'Error'，必须靠 epoch 识别。
    if (!scope.isCurrent(epoch)) throw ABORT_ERROR();
    if ((error as any)?.name === 'AbortError') throw error;
    console.error("Image generation failed:", error);
    throw error;
  }
  // 注意：不再 finally 删除参考图附件（方案 4.1/D3）——附件由模块级缓存跨页复用，
  // 统一在新剧本生成成功 / Start Over 时经 clearReferenceAttachmentCache 批量清理。
};
