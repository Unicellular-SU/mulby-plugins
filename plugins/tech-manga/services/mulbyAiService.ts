import { ComicResponse, CharacterProfile, StoryMode, UsageStat } from "../types";
import { STORY_MODE_PROMPTS } from "../constants";

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
// - 图像 generate 路径暂无中止句柄（待 5.3 迁移 generateStream 后经 __requestId 获得），
//   在途请求会继续在服务端完成，但结果会被作废，不会写入界面。
// 中止后新发起的任务捕获的是新纪元，无需任何重置即可正常运行。

let abortEpoch = 0;
const activeTextRequestIds = new Set<string>();

/** 当前中止纪元；队列型调用方（如资产连续生成循环）可在循环中比对以停止推进 */
export const getAbortEpoch = () => abortEpoch;

/** 一键中止：杀掉在途文本流请求与已登记 requestId 的图像 edit 请求，并作废所有在途任务的结果 */
export const abortAllAiTasks = () => {
  abortEpoch += 1;
  const ai = (window as Window).mulby?.ai;
  if (ai) {
    activeTextRequestIds.forEach(id => safeAbort(ai, id));
  }
  activeTextRequestIds.clear();
};

const ABORT_ERROR = () => new DOMException('Aborted', 'AbortError');

const throwIfAborted = (epoch: number) => {
  if (epoch !== abortEpoch) throw ABORT_ERROR();
};

/** ai.abort 是 IPC Promise，需同时防同步抛与 Promise 拒绝（老宿主返回 void 时 ?.catch?. 安全跳过） */
const safeAbort = (ai: { abort: (id: string) => unknown }, id: string) => {
  try { (ai.abort(id) as Promise<void> | undefined)?.catch?.(() => { /* ignore */ }); } catch { /* ignore */ }
};

/** 解析图像模型：优先用配置面板选择的模型，否则回退到第一个可用的图像生成模型 */
const resolveImageModel = async (): Promise<string> => {
  if (activeModels.imageModel) return activeModels.imageModel;
  const models = await getAi().allModels({ endpointType: 'image-generation' });
  if (!models || models.length === 0) {
    throw new Error("未找到可用的图像生成模型。请在 Mulby 设置 → AI → 模型管理中添加端点类型为「图像生成」的模型。");
  }
  return models[0].id;
};

/** 纯文本创作调用的公共选项：关闭一切工具注入，防止 prompt 注入触发内部工具 */
const NO_TOOLS = {
  capabilities: [] as string[],
  toolingPolicy: { enableInternalTools: false },
  mcp: { mode: 'off' as const },
  skills: { mode: 'off' as const }
};

/** 把 data URL 拆成 mimeType + ArrayBuffer，用于上传 AI 附件 */
const dataUrlToBuffer = (dataUrl: string): { mimeType: string; buffer: ArrayBuffer } => {
  const match = dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  const mimeType = match ? match[1] : 'image/png';
  const base64 = match ? match[2] : (dataUrl.split(',')[1] || dataUrl);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mimeType, buffer: bytes.buffer };
};

// ================= 参考图附件缓存（方案 4.1，遵守 D3） =================
// 同一张参考图整轮会话只上传一次：key = dataUrl 前 256 字符 + 长度，
// value 为 Promise 化 attachmentId（并发页同时 miss 时也只上传一次）。
// 宿主 AttachmentStore 无 TTL、消费后不删除，跨页复用安全；命中后仍以
// attachments.get 校验失效（宿主重启等），失效即重传。

const attachmentCache = new Map<string, Promise<string>>();
const cacheKeyOf = (dataUrl: string) => `${dataUrl.slice(0, 256)}:${dataUrl.length}`;

const uploadRefCached = (ai: ReturnType<typeof getAi>, dataUrl: string): Promise<string> => {
  const key = cacheKeyOf(dataUrl);
  const hit = attachmentCache.get(key);
  if (hit) {
    // 命中失效校验：attachments.get 为 null 则重传（D3）
    return hit.then(async (id) => {
      const meta = await ai.attachments.get(id).catch(() => null);
      if (meta) return id;
      attachmentCache.delete(key);
      return uploadRefCached(ai, dataUrl);
    });
  }
  const p = (async () => {
    const { mimeType, buffer } = dataUrlToBuffer(dataUrl);
    const att = await ai.attachments.upload({ buffer, mimeType, purpose: 'vision' });
    return att.attachmentId;
  })();
  p.catch(() => attachmentCache.delete(key)); // 上传失败不留脏缓存
  attachmentCache.set(key, p);
  return p;
};

/**
 * 删除全部已缓存附件并清空缓存；新剧本生成成功与 Start Over 确认丢弃时调用（D3）。
 * 宿主对附件无 TTL / 会话清理任务，批量 delete 属必要清理而非锦上添花。
 */
export const clearReferenceAttachmentCache = () => {
  const ai = (window as Window).mulby?.ai;
  attachmentCache.forEach((p) =>
    p.then((id) => ai?.attachments.delete(id)).catch(() => { /* ignore */ })
  );
  attachmentCache.clear();
};

/**
 * 宽高比 → 尺寸字符串与 prompt 比例提示（方案 4.7）。
 * - canvasHint：generate 路径用，必须与 size 画布数学一致（否则模型自行留白/加边框凑比例）；
 * - requestedHint：edit 路径用（无 size 画布时忠实用户所选比例；第 6 章宿主分支落地后
 *   size/aspectRatio 随 edit 入参透传，hint 退化为辅助提示）。
 */
const aspectRatioToSize = (aspectRatio: string): {
  size: string; canvasHint: string; requestedHint: string;
} => {
  switch (aspectRatio) {
    case '1:1':  return { size: '1024x1024', canvasHint: 'square 1:1', requestedHint: 'square 1:1' };
    case '4:3':  return { size: '1536x1024', canvasHint: 'landscape 3:2', requestedHint: 'landscape 4:3' };
    case '16:9': return { size: '1536x1024', canvasHint: 'landscape 3:2', requestedHint: 'wide landscape 16:9' };
    case '9:16': return { size: '1024x1536', canvasHint: 'tall portrait 2:3', requestedHint: 'tall portrait 9:16' };
    case '3:4':  return { size: '1024x1536', canvasHint: 'portrait 2:3', requestedHint: 'portrait 3:4' };
    case '2:3':
    default:     return { size: '1024x1536', canvasHint: 'portrait 2:3 (manga page)', requestedHint: 'portrait 2:3 (manga page)' };
  }
};

// 方案 4.6：本地 JSON 提取（大小写不敏感围栏剥离 + 首尾大括号截取，救回前置说明文字等脏输出）
const extractJson = (text: string): string => {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  return start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
};

// Helper for approximate token counting when metadata is missing
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** 图像结果 → data URL（Mulby 返回纯 base64） */
const toDataUrl = (image: string) =>
  image.startsWith('data:') ? image : `data:image/png;base64,${image}`;

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
    1. **UNIVERSE FIDELITY**: Ensure the terminology, tone, and logic fit the specific Universe/Fandom mentioned in the context.
    2. **NO ABSTRACTION**: Do NOT summarize dialogue (e.g., "He explains the plan"). Write the FULL, RICH dialogue.
    3. **CHARACTER VOICE**: Ensure characters sound exactly like their canonical anime/manga counterparts.

    Output: Return ONLY the refined text. Do not include markdown formatting or explanations.
  `;

  const epoch = abortEpoch;

  try {
    const res = await ai.call({
        ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
        messages: [{ role: 'user', content: prompt }],
        ...NO_TOOLS
    });

    throwIfAborted(epoch);

    if (onUsage) {
      onUsage({
        inputTokens: res?.usage?.inputTokens ?? estimateTokens(prompt),
        outputTokens: res?.usage?.outputTokens ?? estimateTokens(typeof res?.content === 'string' ? res.content : ''),
        imagesGenerated: 0,
        modelType: 'GEMINI_3_PRO'
      });
    }

    const content = typeof res?.content === 'string' ? res.content.trim() : '';
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
    Role: Expert Image Prompt Engineer for TechManga.

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

  const epoch = abortEpoch;

  try {
    const result = await ai.call({
      ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
      messages: [{ role: 'user', content: systemPrompt }],
      ...NO_TOOLS
    });

    throwIfAborted(epoch);

    if (onUsage) {
      onUsage({
        inputTokens: result?.usage?.inputTokens ?? estimateTokens(systemPrompt),
        outputTokens: result?.usage?.outputTokens ?? estimateTokens(typeof result?.content === 'string' ? result.content : ''),
        imagesGenerated: 0,
        modelType: 'GEMINI_3_PRO'
      });
    }

    const text = typeof result?.content === 'string' ? result.content : '';
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
      "cover_image_prompt": "String",
      "pages": [
         {
           "page_number": Integer,
           "characters_in_scene": ["String"],
           "props_in_scene": ["String"],
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
             'prop_sheet', 'cover_image_prompt', 'pages'],
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
      // 修复调用同样计费，记入 TokenMonitor
      onUsage?.({
        inputTokens: fixed?.usage?.inputTokens ?? estimateTokens(raw),
        outputTokens: fixed?.usage?.outputTokens ?? estimateTokens(fixedText),
        imagesGenerated: 0,
        modelType: 'GEMINI_3_PRO',
      });
      return JSON.parse(extractJson(fixedText)) as ComicResponse;
    } catch {
      const err = new Error('剧本 JSON 解析失败（已自动修复重试一次）。原始输出已保留在右侧日志面板，可复制后手动修复重用。');
      (err as Error & { rawText?: string }).rawText = raw;
      throw err;
    }
  }
};

// ================= 剧本 systemPrompt 静态前缀（方案 4.5） =================
// system 段完全静态（模块加载时求值一次，字节稳定），命中 OpenAI/Gemini/DeepSeek 类
// 隐式 prompt caching；全部变量（源文本 / castingPhase / 画风 / 页数 / 叙事指令）集中到
// user 消息，且会话内稳定的 Source Material 放最前、可调变量放最后。
const STATIC_SYSTEM_PROMPT = `
    Role: Professional Tech Manga Director and Storyteller.

    Target Art Style: Specified in the user message as "Target Art Style" (CRITICAL: All visual descriptions must match that style).

    Task: Adapt the provided Source Material into a suspenseful, engaging sequential Manga/Comic script.

    ================================================================
    PHASE 1: SOURCE MATERIAL ANALYSIS (INTERNAL)
    ================================================================
    Before writing the script, you must ANALYZE the 'Source Material' provided in the user message.
    Determine its nature:
    - **Technical Guide**? (Linear progress)
    - **Bug Report**? (Mystery/Crisis)
    - **Historical Event**? (Chronological Drama)
    - **Biography**? (Character Study)

    **ADAPT THE PLOT BASED ON THIS ANALYSIS.**
    The story structure must mirror the content's structure.

    ================================================================
    PHASE 2: UNIVERSE & WORLD IMMERSION
    ================================================================
    - **IMMERSION RULE**: The script MUST feel like a legitimate episode.
    - **LORE ADAPTATION**:
       - **IF** Technical/Sci-Fi: Use precise technical jargon.
       - **IF** Historical (Serious): Use period-accurate language and setting. No modern tech unless specified.
       - **IF** Historical (Parody): Mix historical setting with the character's modern quirks (anachronistic humor).

    (PHASE 3 casting rules are provided in the user message.)

    ================================================================
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

export const generateComicScript = async (
  text: string,
  style: string,
  character: CharacterProfile,
  storyMode: StoryMode,
  customStoryPrompt: string | undefined,
  panelCount: number,
  totalPages: string, // "Short", "Medium", "Long"
  onLogUpdate: (logType: 'INPUT' | 'OUTPUT', text: string) => void,
  onUsage?: (stat: UsageStat) => void
): Promise<ComicResponse> => {
  const ai = getAi();

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

  // Select Narrative Instructions based on Story Mode
  let narrativeTemplate = STORY_MODE_PROMPTS[storyMode] || STORY_MODE_PROMPTS[StoryMode.CONFLICT];

  // Handle Custom Story Mode
  if (storyMode === StoryMode.CUSTOM && customStoryPrompt) {
     narrativeTemplate = STORY_MODE_PROMPTS[StoryMode.CUSTOM].replace(/\$\{customPrompt\}/g, customStoryPrompt);
  }

  // Inject character details into the template
  const specificNarrativeInstructions = narrativeTemplate
    .replace(/\$\{character\.name\}/g, character.name)
    .replace(/\$\{character\.description\}/g, character.description);

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

  // 方案 4.5：system 完全静态（STATIC_SYSTEM_PROMPT 模块级常量），变量集中到 user 消息；
  // 会话内稳定的 Source Material 放最前（调 style/页数不使源文本段的缓存前缀失效），可调变量放最后。
  const userPrompt = [
    `Source Material:\n"""\n${text}\n"""`,
    castingPhase,
    `Target Art Style: "${style}"`,
    pageCountInstruction,
    `Panels per Page: ${panelsPerPage}.`,
    `Directives for Plot & Narrative (Style Lens):\n${specificNarrativeInstructions}`,
  ].join('\n\n');

  // Log the input prompt immediately（system + user 拼接，日志观感不变）
  const fullInputText = `${STATIC_SYSTEM_PROMPT}\n\n${userPrompt}`;
  onLogUpdate('INPUT', fullInputText);

  const epoch = abortEpoch;
  let requestId: string | null = null;

  try {
    let fullText = '';
    let streamError: string | null = null;

    const req = ai.call(
      {
        ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
        messages: [
          { role: 'system', content: STATIC_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        // 方案 4.6：API 级 jsonSchema 约束；strict 显式 false（宿主默认 true 会拒复杂嵌套 schema）
        params: {
          responseFormat: 'json_schema',
          jsonSchema: COMIC_JSON_SCHEMA as unknown as Record<string, unknown>,
          jsonSchemaName: 'comic_script',
          strict: false,
        },
        ...NO_TOOLS
      },
      (chunk: any) => {
        if (chunk.__requestId) {
          requestId = chunk.__requestId;
          if (epoch === abortEpoch) {
            activeTextRequestIds.add(chunk.__requestId);
          } else {
            // 捕获到 requestId 时已被中止：立即杀掉请求
            safeAbort(ai, chunk.__requestId);
          }
          return;
        }
        if (epoch !== abortEpoch) return; // 已中止：忽略后续 chunk
        if (chunk.chunkType === 'text' && typeof chunk.content === 'string') {
          fullText += chunk.content;
          onLogUpdate('OUTPUT', fullText);
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
      onUsage({
        inputTokens: finalMsg?.usage?.inputTokens ?? estimateTokens(fullInputText),
        outputTokens: finalMsg?.usage?.outputTokens ?? estimateTokens(fullText),
        imagesGenerated: 0,
        modelType: 'GEMINI_3_PRO'
      });
    }

    if (!fullText) {
      throw new Error(streamError ? `AI 调用失败：${streamError}` : "No response from AI");
    }

    // 方案 4.6：本地提取 → 修复重试一次 → 保留原文抛错；修复调用耗时较长，返回后补一次纪元检查
    const parsed = await parseScriptWithRepair(fullText, onUsage);
    throwIfAborted(epoch);
    // 方案 2.3：不信任模型输出的 page_number，按数组序归一化（封面固定 0，正文 1..N）
    parsed.pages = (parsed.pages ?? []).map((p, i) => ({ ...p, page_number: i + 1 }));
    return parsed;

  } catch (error) {
    // 方案 2.5："是否用户中止"由 epoch 权威判定，不再猜错误文本（含 'abort' 的网关错误应正常上报 UI）
    if (epoch !== abortEpoch) throw ABORT_ERROR();            // 本轮已被用户中止：按中止收敛
    if ((error as any)?.name === 'AbortError') throw error;   // 本地抛出的原生中止（防御性保留）
    console.error("Script generation failed:", error);
    throw error;                                              // 真实失败：原样上报 UI
  } finally {
    if (requestId) activeTextRequestIds.delete(requestId);
  }
};

/**
 * Generates a character reference sheet (Image) based on the description and style.
 */
export const generateCharacterReference = async (
  name: string,
  description: string,
  style: string,
  onUsage?: (stat: UsageStat) => void
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
    - Full body shot, neutral pose, front view.
    - White background.
    - High quality, detailed character sheet.
    - Match the "Target Art Style".
    - **IDENTITY**: Keep the character's canonical facial features, body type, and hair recognizable.
    - **COSTUME**: If the 'Source Material Context' describes a specific costume (e.g. "wearing a spacesuit", "dressed as Napoleon"), you MUST draw them in that costume. Do NOT default to their standard anime outfit if a specific costume is requested.
    - Output image aspect ratio: portrait 2:3.
  `.trim(); // 方案 4.7：hint 与下方 size 1024x1536（精确 2:3）一致，不再谎报 3:4

  const epoch = abortEpoch;

  try {
    const result = await ai.images.generate({
      model,
      prompt,
      size: '1024x1536',
      count: 1
    });

    throwIfAborted(epoch);

    if (onUsage) {
       onUsage({
          inputTokens: result.tokens?.inputTokens || estimateTokens(prompt),
          outputTokens: result.tokens?.outputTokens || 1120,
          imagesGenerated: 1,
          modelType: 'GEMINI_3_PRO_IMAGE'
       });
    }

    const image = result.images?.[0];
    if (image) return toDataUrl(image);

    throw new Error("No image generated for character reference.");
  } catch (error) {
    // 与 2.5 同款 epoch 权威判定：中止后归一为 AbortError（供 withRetryOnce 排除、UI 静默收敛）
    if (epoch !== abortEpoch) throw ABORT_ERROR();
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
  onUsage?: (stat: UsageStat) => void
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
    - **COMPOSITION**: High quality product shot, white background, neutral lighting.
    - **NO TEXT**: Do not include labels.
    - Output image aspect ratio: square 1:1.
  `.trim();

  const epoch = abortEpoch;

  try {
    const result = await ai.images.generate({
      model,
      prompt,
      size: '1024x1024',
      count: 1
    });

    throwIfAborted(epoch);

    if (onUsage) {
       onUsage({
          inputTokens: result.tokens?.inputTokens || estimateTokens(prompt),
          outputTokens: result.tokens?.outputTokens || 1120,
          imagesGenerated: 1,
          modelType: 'GEMINI_3_PRO_IMAGE'
       });
    }

    const image = result.images?.[0];
    if (image) return toDataUrl(image);

    throw new Error("No image generated for prop reference.");
  } catch (error) {
    // 与 2.5 同款 epoch 权威判定：中止后归一为 AbortError（供 withRetryOnce 排除、UI 静默收敛）
    if (epoch !== abortEpoch) throw ABORT_ERROR();
    if ((error as any)?.name === 'AbortError') throw error;
    console.error("Prop reference generation failed:", error);
    throw error;
  }
};

export const generatePanelImage = async (
  prompt: string,
  aspectRatio: string,
  referenceImages?: string[], // Optional array of base64 images
  onUsage?: (stat: UsageStat) => void
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
      - **ACTION (DYNAMIC)**: **DO NOT COPY THE POSE** from the reference images. The reference images are static character sheets (mugshots).
      - **POSE INSTRUCTION**: You MUST make the character perform the ACTION described in the "TEXT PROMPT" below (e.g., running, fighting, typing, shouting). Make the pose dynamic and dramatic.

      INSTRUCTION FOR SCENE:
      - **ART STYLE ENFORCEMENT**: The image MUST be generated in the requested Art Style.
      - **SEQUENTIAL FLOW**: Ensure visual continuity between panels. If multiple panels are described, they must look like a continuous sequence, not random images.
      - Follow the TEXT PROMPT below for Action, Composition, and Background.

      LANGUAGE RULE:
      - **Dialogue, Labels, and Sound Effects**: MUST be in Simplified Chinese (简体中文) unless the script specifically asks for English.
      - **Code, Technical Terms, Log Outputs**: MUST remain in English (do not translate "const", "function", "Error 404", etc.).

      TEXT PROMPT (SOURCE OF ACTION & COMPOSITION):
      ${prompt}

      ENSURE THE ART STYLE IS APPLIED HEAVILY.
     `;
  }

  // 方案 4.7：generate 路径用 canvasHint（与 size 画布数学一致，防留白/边框）；
  // edit 路径无固定画布，用 requestedHint 忠实用户所选比例（与随入参透传的 aspectRatio 一致）。
  finalPrompt = `${finalPrompt}\n\nOutput image aspect ratio: ${hasRefs ? requestedHint : canvasHint}.`;

  const refAttachmentIds: string[] = [];
  const epoch = abortEpoch;

  try {
    let result: { images: string[]; tokens: { inputTokens: number; outputTokens: number } };

    if (hasRefs) {
      // 带参考图：附件经模块级缓存复用（方案 4.1，同一张图整轮会话只上传一次），走 images.edit
      for (const imgData of referenceImages!) {
        throwIfAborted(epoch);
        refAttachmentIds.push(await uploadRefCached(ai, imgData));
      }
      throwIfAborted(epoch);

      // 第 6 章对接：自生成 requestId 随 input 传入并登记进中止集合——新宿主
      // （feat/ai-image-abort-and-size）abortAllAiTasks 即可真杀在途 edit；
      // 老宿主对多余的 requestId/size/aspectRatio 字段安全忽略，自动退化为现状（D6，无显式探测）。
      const editRequestId = `techmanga-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      activeTextRequestIds.add(editRequestId);
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
        activeTextRequestIds.delete(editRequestId);
      }
    } else {
      result = await ai.images.generate({
        model,
        prompt: finalPrompt,
        size,
        count: 1
      });
    }

    throwIfAborted(epoch);

    if (onUsage) {
        let actualInputTokens = result.tokens?.inputTokens || 0;
        let actualOutputTokens = result.tokens?.outputTokens || 0;
        if (!actualInputTokens) {
            const imageInputTokens = (referenceImages?.length || 0) * 560;
            actualInputTokens = estimateTokens(finalPrompt) + imageInputTokens;
        }
        if (!actualOutputTokens) actualOutputTokens = 1120;

        onUsage({
           inputTokens: actualInputTokens,
           outputTokens: actualOutputTokens,
           imagesGenerated: 1,
           modelType: 'GEMINI_3_PRO_IMAGE'
        });
     }

    const image = result.images?.[0];
    if (image) return toDataUrl(image);

    throw new Error("No image data found in response");

  } catch (error) {
    // 与 2.5 同款 epoch 权威判定：中止后归一为 AbortError（供 withRetryOnce 排除、UI 静默收敛）。
    // 真被 ai.abort 杀掉的 edit 请求跨 IPC 后 name 恒为 'Error'，必须靠 epoch 识别。
    if (epoch !== abortEpoch) throw ABORT_ERROR();
    if ((error as any)?.name === 'AbortError') throw error;
    console.error("Image generation failed:", error);
    throw error;
  }
  // 注意：不再 finally 删除参考图附件（方案 4.1/D3）——附件由模块级缓存跨页复用，
  // 统一在新剧本生成成功 / Start Over 时经 clearReferenceAttachmentCache 批量清理。
};
