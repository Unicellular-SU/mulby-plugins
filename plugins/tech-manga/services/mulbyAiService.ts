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

/** 宽高比 → 尺寸字符串（images.generate 的 size 参数），并附带用于 prompt 的比例提示 */
const aspectRatioToSize = (aspectRatio: string): { size: string; hint: string } => {
  let ratio = aspectRatio;
  if (ratio === '2:3') ratio = '3:4'; // 与原实现保持一致：2:3 归一化为 3:4
  switch (ratio) {
    case '1:1': return { size: '1024x1024', hint: 'square 1:1' };
    case '4:3': return { size: '1536x1024', hint: 'landscape 4:3' };
    case '16:9': return { size: '1536x1024', hint: 'wide landscape 16:9' };
    case '9:16': return { size: '1024x1536', hint: 'tall portrait 9:16' };
    case '3:4':
    default: return { size: '1024x1536', hint: 'portrait 3:4 (manga page)' };
  }
};

// Helper to strip markdown json blocks if they appear
const cleanJson = (text: string) => {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
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

  try {
    const res = await ai.call({
        ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
        messages: [{ role: 'user', content: prompt }],
        ...NO_TOOLS
    });

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

  try {
    const result = await ai.call({
      ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
      messages: [{ role: 'user', content: systemPrompt }],
      ...NO_TOOLS
    });

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

  const systemPrompt = `
    Role: Professional Tech Manga Director and Storyteller.

    Target Art Style: "${style}" (CRITICAL: All visual descriptions must match this style).

    Task: Adapt the provided Source Material into a suspenseful, engaging sequential Manga/Comic script.

    ================================================================
    PHASE 1: SOURCE MATERIAL ANALYSIS (INTERNAL)
    ================================================================
    Before writing the script, you must ANALYZE the 'Source Material' below.
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

    ${castingPhase}

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
    - ${pageCountInstruction}
    - Panels per Page: ${panelsPerPage}.

    Source Material:
    """
    ${text}
    """

    Directives for Plot & Narrative (Style Lens):
    ${specificNarrativeInstructions}

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
    - The 'global_art_style' field in JSON must describe "${style}" in detail.

    **Spatial Anchoring & Text Embedding (STRICT)**:
    - **Mandatory Format**: "Includes speech bubble located [POSITION] pointing to [CHARACTER] with text: '[CHINESE DIALOGUE]'"
    - **NO SPEAKER PREFIX**: Do NOT include "Name:" inside the quote.
    - **NO TRANSLATIONS**: Do NOT include English translation.

    ${getJsonSchemaString()}
  `;

  // Log the input prompt immediately
  onLogUpdate('INPUT', systemPrompt);

  try {
    let fullText = '';
    let streamError: string | null = null;

    const req = ai.call(
      {
        ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
        messages: [{ role: 'user', content: systemPrompt }],
        params: { responseFormat: 'json_object' },
        ...NO_TOOLS
      },
      (chunk: any) => {
        if (chunk.__requestId) return;
        if (chunk.chunkType === 'text' && typeof chunk.content === 'string') {
          fullText += chunk.content;
          onLogUpdate('OUTPUT', fullText);
        } else if (chunk.chunkType === 'error' && chunk.error?.message) {
          streamError = chunk.error.message;
        }
      }
    );

    const finalMsg = await req;

    // 非流式兜底：部分 provider 直接返回完整内容
    if (!fullText && typeof finalMsg?.content === 'string') {
      fullText = finalMsg.content;
      if (fullText) onLogUpdate('OUTPUT', fullText);
    }

    if (onUsage) {
      onUsage({
        inputTokens: finalMsg?.usage?.inputTokens ?? estimateTokens(systemPrompt),
        outputTokens: finalMsg?.usage?.outputTokens ?? estimateTokens(fullText),
        imagesGenerated: 0,
        modelType: 'GEMINI_3_PRO'
      });
    }

    if (!fullText) {
      throw new Error(streamError ? `AI 调用失败：${streamError}` : "No response from AI");
    }

    const parsed = JSON.parse(cleanJson(fullText));
    return parsed as ComicResponse;

  } catch (error) {
    console.error("Script generation failed:", error);
    throw error;
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
    - Output image aspect ratio: portrait 3:4.
  `.trim();

  try {
    const result = await ai.images.generate({
      model,
      prompt,
      size: '1024x1536',
      count: 1
    });

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

  try {
    const result = await ai.images.generate({
      model,
      prompt,
      size: '1024x1024',
      count: 1
    });

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
  const { size, hint } = aspectRatioToSize(aspectRatio);

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

  finalPrompt = `${finalPrompt}\n\nOutput image aspect ratio: ${hint}.`;

  const uploadedAttachmentIds: string[] = [];

  try {
    let result: { images: string[]; tokens: { inputTokens: number; outputTokens: number } };

    if (hasRefs) {
      // 带参考图：上传附件后走 images.edit（主图 + 额外参考图，多图一致性）
      for (const imgData of referenceImages!) {
        const { mimeType, buffer } = dataUrlToBuffer(imgData);
        const attachment = await ai.attachments.upload({ buffer, mimeType, purpose: 'vision' });
        uploadedAttachmentIds.push(attachment.attachmentId);
      }

      result = await ai.images.edit({
        model,
        imageAttachmentId: uploadedAttachmentIds[0],
        referenceAttachmentIds: uploadedAttachmentIds.slice(1),
        prompt: finalPrompt
      });
    } else {
      result = await ai.images.generate({
        model,
        prompt: finalPrompt,
        size,
        count: 1
      });
    }

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
    console.error("Image generation failed:", error);
    throw error;
  } finally {
    // 清理临时上传的参考图附件（尽力而为）
    for (const id of uploadedAttachmentIds) {
      ai.attachments.delete(id).catch(() => { /* ignore */ });
    }
  }
};
