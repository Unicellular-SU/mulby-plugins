import { ComicResponse, StoryMode, EndingType, AppConfig, ColorMode, CharacterSheetItem, OnTokenUpdate } from "../types";
import { STORY_MODE_PROMPTS } from "../constants";

// ================= MULBY AI BRIDGE =================
// 所有 AI 能力通过 Mulby 宿主提供的 window.mulby.ai 完成，
// 模型在插件配置面板中选择（文本模型 / 图像模型），密钥由 Mulby 统一管理。

const getAi = () => {
  const ai = (window as Window).mulby?.ai;
  if (!ai) {
    throw new Error("Mulby AI 接口不可用。请在 Mulby 中打开本插件，并确认已在 Mulby 设置中配置 AI 模型。");
  }
  return ai;
};

/** 解析图像模型：优先用配置面板选择的模型，否则回退到第一个可用的图像生成模型 */
const resolveImageModel = async (config?: AppConfig): Promise<string> => {
  if (config?.imageModel) return config.imageModel;
  const models = await getAi().allModels({ endpointType: 'image-generation' });
  if (!models || models.length === 0) {
    throw new Error("未找到可用的图像生成模型。请在 Mulby 设置 → AI → 模型管理中添加端点类型为「图像生成」的模型。");
  }
  return models[0].id;
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

// ================= COST CALCULATION CONSTANTS =================
// 沿用原项目的估算价格模型（仅用于界面上的 EST. COST 显示，非精确账单）
const PRICING = {
  TEXT_INPUT_PER_1M: 2.00,
  TEXT_OUTPUT_PER_1M: 12.00,
  IMAGE_INPUT_TOKENS: 560, // Fixed token cost per input image
  IMAGE_OUTPUT_TOKENS: 1120,
  IMAGE_OUTPUT_PRICE_PER_1M_TOKENS: 120.00
};

/**
 * Calculates cost based on usage stats and user defined pricing model
 */
const calculateUsageCost = (
  inputTokens: number,
  outputTokens: number,
  isImageOutput: boolean = false
): number => {
  const inputCost = (inputTokens / 1_000_000) * PRICING.TEXT_INPUT_PER_1M;

  let outputCost = 0;
  if (isImageOutput) {
     outputCost = (outputTokens / 1_000_000) * PRICING.IMAGE_OUTPUT_PRICE_PER_1M_TOKENS;
  } else {
     outputCost = (outputTokens / 1_000_000) * PRICING.TEXT_OUTPUT_PER_1M;
  }

  return inputCost + outputCost;
};

// Helper for approximate token counting when metadata is missing (1 word ~= 1.3 tokens)
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Constructs the System Prompt
 */
const constructSystemPrompt = (
  style: string,
  storyMode: StoryMode,
  panelCount: number,
  totalPages: string,
  secondaryStoryMode?: StoryMode,
  endingType?: EndingType,
  colorMode?: ColorMode
): string => {
   // Instruction for panel density per page
  const panelsPerPage = panelCount > 0 ? `Exactly ${panelCount} panels per page` : "Auto-determined (1 to 10 panels) based on pacing";

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
  let narrativeInstructions = `**PRIMARY GENRE: ${storyMode}**\n${STORY_MODE_PROMPTS[storyMode] || STORY_MODE_PROMPTS[StoryMode.GHOST]}`;

  // Mix in Secondary Mode if present
  if (secondaryStoryMode && secondaryStoryMode !== storyMode) {
      narrativeInstructions += `\n\n**SECONDARY GENRE (CROSS-OVER BLEND): ${secondaryStoryMode}**\n${STORY_MODE_PROMPTS[secondaryStoryMode]}`;
      narrativeInstructions += `\n\n**CROSS-OVER INSTRUCTION**: You must blend the themes of the Primary Genre with the tropes of the Secondary Genre. For example, if blending "Ghost" with "Tech", create a digital haunting or AI ghost.`;
  }

  // Add Ending Instruction
  const endingInstruction = endingType ? `\n\n**MANDATORY ENDING TYPE: ${endingType}**\nThe story MUST conclude with this specific type of ending. Structure the plot to arrive at this point naturally.` : "";

  // Color Mode Logic - SUPREME RULE
  const colorInstruction = colorMode === ColorMode.BLACK_AND_WHITE
    ? `
    ================================================================
    SUPREME COLOR RULE: BLACK & WHITE MODE (OVERRIDE)
    ================================================================
    - **CRITICAL**: The output images MUST be strictly Black and White (Manga Ink Style).
    - **FORBIDDEN**: Do NOT use color adjectives like "red", "blue", "green", "blonde", "purple" in the 'image_prompt' or 'character_sheet'.
    - **MANDATORY TRANSLATION**: You must translate all color concepts to VALUES or TEXTURES:
      - "Red blood" -> "Black blood" or "Dark liquid"
      - "Blue dress" -> "Dark dress" or "White dress" (depending on brightness)
      - "Blonde hair" -> "Light hair" or "White hair"
      - "Green eyes" -> "Intense eyes" or "Dark eyes"
    - **Keywords to use**: Ink, Screentone, Cross-hatching, Monochrome, High Contrast, Noir.
    - **Override**: This rule overrides ANY color mention in the "Art Style" definition. Even if the style is "American Horror" (usually colored), you MUST describe it as a Black & White version.
    `
    : `
    ================================================================
    SUPREME COLOR RULE: FULL COLOR MODE (OVERRIDE)
    ================================================================
    - **CRITICAL**: The output images MUST be Full Color.
    - **Override**: Even if the Art Style is "Junji Ito" (usually B&W), you MUST describe it as a **Full Color** version.
    - Use vivid, dramatic lighting colors (e.g., "Neon red lighting", "Sickly green mist").
    `;

  return `
    Role: Professional Horror Manga Artist and Storyteller.

    Task: Adapt the provided Horror Story/Outline into a suspenseful, sequential Horror Manga script.

    ${colorInstruction}

    ================================================================
    1. DEEP STYLE INTEGRATION (CRITICAL)
    ================================================================
    The user has selected a specific "Master Style" which dictates BOTH the Art AND the Narrative Logic.

    SELECTED STYLE DEFINITION:
    """
    ${style}
    """

    **INSTRUCTION**: You must analyze the text above.
    - **[Art] section**: Apply this to the 'image_prompt'.
    - **[Story] & [Tone] sections**: Apply this to the **SCRIPT WRITING** and **PLOT PACING**.
      - If style is **Junji Ito**: The story must involve obsession, slow corruption, and inevitable doom. No happy endings.
      - If style is **American Horror**: The story must feel like a morality tale with ironic punishment. Dialogue should be pulpy and dramatic.
      - If style is **Found Footage**: The story must focus on the "Unseen" and realistic panic.
    - **DO NOT** write a generic horror story. Write a story that feels like it was written by the specific author defined in the style.

    ================================================================
    2. DIALOGUE & NARRATIVE RICHNESS (CRITICAL)
    ================================================================
    **PROBLEM**: Previous scripts had dialogue that was too brief, generic, or summary-like (e.g., "Help me.").
    **SOLUTION**: You must write **FULL, SUBSTANTIAL, and NATURAL** dialogue.

    - **Avoid "Summary Speak"**: Do NOT write "He explains the history of the house." -> WRITE THE ACTUAL EXPLANATION.
    - **Emotional Depth**: Characters should stutter, scream, whisper, beg, or rant depending on the situation.
    - **Exposition is Allowed**: If the plot is complex, use meaningful dialogue exchanges to explain it. Do not rely solely on visual ambiguity.
    - **Length**: Speech bubbles can be long if necessary. A panel can have multiple bubbles.
    - **Chinese Language**: All dialogue must be in natural, high-quality **Simplified Chinese (简体中文)**.

    ================================================================
    3. LENGTH & DENSITY CONSTRAINTS
    ================================================================
    - ${pageCountInstruction}
    - Panels per Page: ${panelsPerPage}.
    - Pacing is Key: Use silent panels to build tension, and splash pages for the "Reveal" or "Climax".

    Directives for Plot & Atmosphere:
    ${narrativeInstructions}
    ${endingInstruction}

    4. **Build Tension**:
        - Focus on atmosphere and dread rather than just explicit violence.
        - Use "Visual Silence" STRATEGICALLY (not excessively).
        - Focus on the "Uncanny Valley" - things that look almost human but not quite.

    5. **Sequential Logic & Continuity (CRITICAL)**:
       - **Flow**: The transition between Page X and Page X+1 MUST be seamless.
       - **Connection Rule**: Panel 1 of the current page must visually and narratively follow the Last Panel of the previous page immediately.
       - **Avoid Teleporting**: If Page 1 ends with a character reaching for a door, Page 2 Panel 1 MUST show the door opening. Do not skip actions.

    6. **Text Density Rules (ANTI-CONFUSION)**:
       - **Minimum Density**: Each page MUST have at least ONE of the following:
        a. 1 narration box, OR
        b. 2 dialogue exchanges (back-and-forth counts as 2)
       - **Exception**: A maximum of ONE "pure silent" page is allowed for dramatic effect (e.g., splash page reveal).
       - **Post-Silence Rule**: After a silent/low-text horror panel, the NEXT panel should include character reaction dialogue or explanatory narration.

    Directives for Visuals & Image Generation (CRITICAL):
    1. **Dynamic Character Design (VISUAL LOCKING & EVOLUTION)**:
        - The user has NOT provided character descriptions.
        - You MUST analyze the story, identify the Protagonist, Antagonist, and Victims.
        - Create a 'character_sheet' for them.
        - **BASE STATE DEFINITION**: The 'description' field represents the character's **INITIAL** appearance at the start of the story.
          - You MUST define:
            1. **Base Hairstyle & Shade**: (e.g., "Shoulder-length straight dark hair").
            2. **Base Outfit & Texture**: (e.g., "Dark blazer, white shirt, messy tie").
            3. **Fixed Features**: (e.g., "Mole under left eye").
            - **OUTFIT LOCK (CRITICAL)**: You MUST define the outfit explicitly.
              - IF BLACK & WHITE MODE: Use terms like "Dark", "Light", "Patterned". Do NOT use "Red", "Blue".
              - IF COLOR MODE: Use specific colors.
        - **VISUAL EVOLUTION / OVERRIDE RULE**:
            - If the plot causes a permanent or temporary change (e.g., "Hair turns white from shock", "Clothes are torn and bloody", "Gets a scar"), you MUST handle this in the 'image_prompt'.
            - **INSTRUCTION**: Inside the 'image_prompt', you must explicitly describe the **NEW** state and use the keyword **[APPEARANCE CHANGE]** to emphasize it.
            - Example: "Panel 3: Close up on her face. [APPEARANCE CHANGE] Her hair has turned completely WHITE due to terror. She is screaming."
            - Logic: This specific description in the prompt will help the image generator understand that the 'black hair' in the base description is now invalid.

    2. **Layout Enforcement**:
        - The 'image_prompt' MUST describe the **FULL PAGE LAYOUT**.
        - **Cinematic Flow**: Ensure the panels flow logically (e.g., Wide Shot -> Medium Shot -> Close Up).
        - Start with "A horror manga page divided into X panels...".
        - Describe the framing: "Panel 1 is a wide shot establishing isolation. Panel 2 is an extreme close-up on a fearful eye."
        - **MANDATORY STATE PREAMBLE (For Page 2+)**:
          Every image_prompt for Page 2 onwards MUST begin with a "[VISUAL STATE]" block that explicitly declares:
          1. Each character's CURRENT physical state (position, pose, ongoing actions)
          2. Any persistent conditions (injuries, transformations, floating, etc.)
          3. Environment state (lighting, damage, threats present)
          Format:
          "[VISUAL STATE]
          - 小美: FLOATING 1.5m above floor (NOT standing), white hair (was black), torn dress, terrified expression
          - 房间: red moonlight, shattered window, glass suspended in air
          - 威胁: shadow figure at doorway, reaching toward 小美
          [/VISUAL STATE]
          A horror manga page divided into 4 panels..."
          - **CRITICAL**: This [VISUAL STATE] block will be used by the image generator to maintain consistency.
          - Use NEGATIVE EMPHASIS for states that might be misinterpreted:
            - "FLOATING (NOT standing)"
            - "crawling on ceiling (NOT on floor)"
            - "eyes MISSING (empty sockets)"

    3. **Spatial Anchoring & Text Embedding**:
        - **Problem**: Image models often assign speech bubbles to the wrong character.
        - **Solution**: You MUST define explicit POSITIONS (Left/Right/Center) for characters and bind the speech bubbles to them.
        - **Step A (Character Positioning)**: e.g. "Ghost hovering in top LEFT corner, Victim cowering in bottom RIGHT."
        - **Step B (Bubble Binding)**: e.g. "A jagged scream bubble on the RIGHT coming from the Victim containing text: '...'"
        - **Mandatory Format**: "Includes speech bubble located [POSITION] pointing to [CHARACTER] with text: '[CHINESE DIALOGUE]'"
        - **Language & Text Purity (CRITICAL)**:
          - The text content inside the quotes MUST be in SIMPLIFIED CHINESE (简体中文).
          - **STRICT PROHIBITION**: Do NOT include the English translation, original source text, or pronunciation in parentheses.
          - **BAD Example**: "text: '快跑 (Run)'" or "text: '救命 (Help)'" -> THIS IS FORBIDDEN.
          - **GOOD Example**: "text: '快跑'" or "text: '救命'" -> THIS IS CORRECT.
          - **Completeness**: ALL dialogue from the script MUST be included in the 'image_prompt'.

    4. **Character Presence Logic**:
        - For each page, you MUST identify exactly which characters appear.
        - Only list characters in 'characters_in_scene' if they are physically visible on that page.

    5. **Narration Box System (CRITICAL for Story Clarity)**:
        - **Purpose**: Use RECTANGULAR narration boxes (方形旁白框) to provide context that visuals alone cannot convey.
        - **Types of Narration Boxes**:
            a. **Scene-Setting** (场景设定): Establishes time/place. E.g., "三天前..." "那是一个雨夜..."
            b. **Internal Monologue** (内心独白): Character's thoughts. E.g., "我当时并不知道..." "有什么不对劲..."
            c. **Transition** (过渡连接): Bridges scenes. E.g., "第二天早上..." "与此同时..."
            d. **Retrospective** (回顾): Foreshadowing or hindsight. E.g., "如果当时我选择离开..." "那是我最后一次见到她..."
        - **Visual Format in image_prompt**:
            - "Rectangular narration box at [TOP-LEFT/TOP-RIGHT/BOTTOM] of Panel X, NO pointer tail, with text: '[CHINESE TEXT]'"
        - **MANDATORY USAGE**:
            - Page 1 MUST have a scene-setting narration box.
            - Any TIME SKIP or LOCATION CHANGE must be announced via narration box.
            - The FINAL page should have a retrospective or conclusive narration box.
    6. **Negative Emphasis for Ambiguous States**:
        - Image generators often default to "normal" states (standing, intact, normal appearance).
        - To prevent this, use NEGATIVE EMPHASIS when describing non-default states:
        | 状态 | ❌ 弱描述 | ✅ 强描述（带否定） |
        |------|----------|-------------------|
        | 悬浮 | "floating in air" | "floating 1m above floor (feet NOT touching ground)" |
        | 爬墙 | "on the wall" | "crawling on wall (body perpendicular to floor, defying gravity)" |
        | 倒吊 | "hanging" | "hanging upside down from ceiling (head pointing DOWN)" |
        | 缺失 | "no eyes" | "empty eye sockets (NO eyeballs, just dark holes)" |
        | 变色 | "white hair" | "pure white hair (NOT black, completely changed)" |
        - **INSTRUCTION**: In image_prompt, whenever a character is in a non-default state, include the negative clarification in parentheses.
  `;
};

// Text version of JSON schema appended to the system prompt (works across all providers)
const getJsonSchemaString = () => `
    **Output Schema (JSON)**:
    You MUST respond with a single valid JSON object.

    Structure:
    {
      "title": "String (Scary Manga Title in Chinese)",
      "global_art_style": "String (Description of the art style. DO NOT INCLUDE CHARACTERS)",
      "analysis": "String (Brief strategic breakdown of horror elements and pacing)",
      "character_sheet": [
         { "name": "String", "description": "String" }
      ],
      "cover_image_prompt": "String",
      "pages": [
         {
           "page_number": Integer,
           "characters_in_scene": ["String", "String"],
           "layout_description": "String",
           "image_prompt": "String (Full visual description with [VISUAL STATE] block)",
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
           "state_changes_this_page": ["String"]
         }
      ]
    }
`;

/**
 * 通过 Mulby AI 流式调用文本模型。
 * 返回完整文本；支持通过 AbortSignal 中止（内部桥接为 ai.abort(requestId)）。
 */
const callMulbyTextStream = async (
    systemPrompt: string,
    userPrompt: string,
    model: string | undefined,
    onLogUpdate: (type: 'INPUT' | 'OUTPUT', text: string) => void,
    signal?: AbortSignal,
    onTokenUpdate?: OnTokenUpdate,
    callType: 'script' | 'refinement' = 'script'
): Promise<string> => {
    const ai = getAi();

    onLogUpdate('INPUT', `[MULBY AI${model ? `: ${model}` : ' (默认模型)'}]\n${systemPrompt}\n\nUSER PROMPT:\n${userPrompt}`);

    let fullText = "";
    let requestId: string | null = null;
    let streamError: string | null = null;

    const onAbort = () => {
        if (requestId) {
            try { ai.abort(requestId); } catch { /* ignore */ }
        }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
        const req = ai.call(
            {
                ...(model ? { model } : {}),
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                params: { responseFormat: 'json_object' },
                // 纯文本创作调用：关闭一切工具注入，防止 prompt 注入触发内部工具
                capabilities: [],
                toolingPolicy: { enableInternalTools: false },
                mcp: { mode: 'off' },
                skills: { mode: 'off' }
            },
            (chunk: any) => {
                if (chunk.__requestId) {
                    requestId = chunk.__requestId;
                    if (signal?.aborted) onAbort();
                    return;
                }
                if (signal?.aborted) return;
                if (chunk.chunkType === 'text' && typeof chunk.content === 'string') {
                    fullText += chunk.content;
                    onLogUpdate('OUTPUT', fullText);
                } else if (chunk.chunkType === 'error' && chunk.error?.message) {
                    streamError = chunk.error.message;
                }
            }
        );

        const finalMsg = await req;

        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        // 非流式兜底：部分 provider 直接返回完整内容
        if (!fullText && typeof finalMsg?.content === 'string') {
            fullText = finalMsg.content;
            if (fullText) onLogUpdate('OUTPUT', fullText);
        }

        if (onTokenUpdate) {
            const inputTokens = finalMsg?.usage?.inputTokens ?? estimateTokens(systemPrompt + userPrompt);
            const outputTokens = finalMsg?.usage?.outputTokens ?? estimateTokens(fullText);
            onTokenUpdate({
                promptTokens: inputTokens,
                responseTokens: outputTokens,
                totalCost: calculateUsageCost(inputTokens, outputTokens, false),
                callType
            });
        }

        if (!fullText) {
            throw new Error(streamError
                ? `AI 调用失败：${streamError}`
                : "AI 未返回内容。模型可能过载或请求被安全策略拦截，请稍后重试。");
        }

        return fullText;
    } catch (error: any) {
        if (signal?.aborted || error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('abort')) {
            throw new DOMException('Aborted', 'AbortError');
        }
        throw error;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
};

export const generateComicScript = async (
  storyOutline: string,
  style: string,
  storyMode: StoryMode,
  panelCount: number,
  totalPages: string, // "Short", "Medium", "Long"
  onLogUpdate: (logType: 'INPUT' | 'OUTPUT', text: string) => void,
  signal?: AbortSignal,
  secondaryStoryMode?: StoryMode,
  endingType?: EndingType,
  config?: AppConfig,
  onTokenUpdate?: OnTokenUpdate
): Promise<ComicResponse> => {

  const systemPrompt = constructSystemPrompt(style, storyMode, panelCount, totalPages, secondaryStoryMode, endingType, config?.colorMode)
      + "\n\n" + getJsonSchemaString();
  const userPrompt = `Source Story:\n"""\n${storyOutline}\n"""`;

  const fullText = await callMulbyTextStream(
      systemPrompt,
      userPrompt,
      config?.textModel,
      onLogUpdate,
      signal,
      onTokenUpdate,
      'script'
  );

  // Common JSON Parsing Logic
  try {
      const parsed = JSON.parse(cleanJson(fullText));
      return parsed as ComicResponse;
  } catch (e) {
      console.error("JSON Parsing failed", e);
      throw new Error("Failed to parse AI response as JSON. The model may have output unstructured text.");
  }
};

/**
 * Generic Text Refinement Service (Review Phase)
 */
export const refineText = async (
    originalText: string,
    instruction: string,
    context: string,
    config?: AppConfig,
    onTokenUpdate?: OnTokenUpdate
): Promise<string> => {

    const systemPrompt = `
        Role: Horror Manga Editor.
        Task: Refine and rewrite the user's text based on their specific instruction.
        Context: The text is part of a horror manga script/metadata.
        Rules:
        1. Maintain the horror tone.
        2. Be concise but descriptive.
        3. Return ONLY the rewritten text.

        Additional Context:
        ${context}
    `;

    const userPrompt = `
        ORIGINAL TEXT:
        """
        ${originalText}
        """

        INSTRUCTION:
        "${instruction}"

        REWRITTEN TEXT:
    `;

    const ai = getAi();
    const response = await ai.call({
        ...(config?.textModel ? { model: config.textModel } : {}),
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' }
    });

    if (onTokenUpdate && response?.usage) {
        const inputTokens = response.usage.inputTokens || 0;
        const outputTokens = response.usage.outputTokens || 0;
        onTokenUpdate({
            promptTokens: inputTokens,
            responseTokens: outputTokens,
            totalCost: calculateUsageCost(inputTokens, outputTokens, false),
            callType: 'refinement'
        });
    }

    const content = typeof response?.content === 'string' ? response.content.trim() : '';
    return content || originalText;
};

export const refineImagePrompt = async (
  currentPrompt: string,
  instruction: string,
  style: string,
  analysis?: string,
  characterSheet?: CharacterSheetItem[],
  config?: AppConfig,
  onTokenUpdate?: OnTokenUpdate
): Promise<string> => {

    const characterContext = characterSheet
        ? characterSheet.map(c => `- ${c.name}: ${c.description}`).join('\n')
        : "No character data available.";

    const prompt = `
        Role: Horror Manga Art Director and Prompt Engineer.
        Task: Modify an existing Image Generation Prompt based on specific user feedback, while preserving the core style, character consistency, and technical formatting.

        **CONTEXT**:
        - **Current Art Style**: ${style}
        - **Target Model**: High fidelity image generation model
        - **Format Requirement**: The prompt likely contains technical blocks like [VISUAL STATE]. THESE MUST BE PRESERVED.

        **STORY ANALYSIS (THEME & PACING)**:
        "${analysis || 'N/A'}"

        **CHARACTER REFERENCE (DO NOT HALLUCINATE NEW CHARACTERS)**:
        ${characterContext}

        **INPUT PROMPT**:
        """
        ${currentPrompt}
        """

        **USER INSTRUCTION (Modification)**:
        """
        ${instruction}
        """

        **RULES**:
        1. **Preserve Structure**: Do NOT remove the [VISUAL STATE]...[/VISUAL STATE] block if it exists.
        2. **Apply Change**: Integrate the user's instruction naturally into the scene description.
           - If they ask to change a character's action, update the relevant panel description.
           - If they ask to change lighting, update the atmosphere description.
        3. **Maintain Style**: Ensure the modification respects the "${style}" horror aesthetic (e.g. if user says "make it scary", use style-specific scary terms like "cross-hatching" or "visceral").
        4. **Global Consistency**: Refer to the 'Story Analysis' and 'Character Reference' to ensure your modification doesn't contradict the established lore or character designs (e.g. don't change a character's fixed hair color unless explicitly asked).
        5. **Chinese Text**: If the user instruction involves changing dialogue, update the 'text: "..."' parts ensuring Simplified Chinese.

        **OUTPUT**:
        Return ONLY the modified prompt string. Do not wrap in quotes or markdown.
    `;

    try {
        const ai = getAi();
        const response = await ai.call({
            ...(config?.textModel ? { model: config.textModel } : {}),
            messages: [{ role: 'user', content: prompt }],
            capabilities: [],
            toolingPolicy: { enableInternalTools: false },
            mcp: { mode: 'off' },
            skills: { mode: 'off' }
        });

        if (onTokenUpdate && response?.usage) {
            const inputTokens = response.usage.inputTokens || 0;
            const outputTokens = response.usage.outputTokens || 0;
            onTokenUpdate({
                promptTokens: inputTokens,
                responseTokens: outputTokens,
                totalCost: calculateUsageCost(inputTokens, outputTokens, false),
                callType: 'refinement'
            });
        }

        const content = typeof response?.content === 'string' ? response.content.trim() : '';
        return content || currentPrompt;
    } catch (e) {
        console.warn("Prompt refinement failed, returning original prompt:", e);
        return currentPrompt; // Fallback to original prompt on error
    }
};

/**
 * Generates a "Casting Sheet" reference image for a specific character
 */
export const generateCharacterReference = async (
    name: string,
    description: string,
    style: string,
    colorMode: string,
    onTokenUpdate?: OnTokenUpdate,
    config?: AppConfig
): Promise<string> => {
    const ai = getAi();
    const model = await resolveImageModel(config);

    const colorKeywords = colorMode === ColorMode.BLACK_AND_WHITE
        ? "monochrome, black and white, ink illustration, high contrast, manga screentones"
        : "full color, vivid, detailed illustration";

    // Design a prompt specifically for character sheets
    const prompt = `
      Character Design Sheet for "${name}".
      Visual Description: ${description}.
      Art Style: ${style}. ${colorKeywords}.

      Requirements:
      - Full body character reference.
      - Neutral pose, front facing.
      - White or simple background.
      - No text, no speech bubbles.
      - Clear definition of outfit and facial features for consistency reference.
      - High quality concept art.
      - Output image aspect ratio: portrait 3:4.
    `;

    try {
        const result = await ai.images.generate({
            model,
            prompt,
            size: '1024x1536',
            count: 1
        });

        if (onTokenUpdate) {
            const inputTokens = result.tokens?.inputTokens || estimateTokens(prompt);
            const outputTokens = result.tokens?.outputTokens || PRICING.IMAGE_OUTPUT_TOKENS;
            onTokenUpdate({
                promptTokens: inputTokens,
                responseTokens: outputTokens,
                totalCost: calculateUsageCost(inputTokens, outputTokens, true),
                callType: 'image_ref'
            });
        }

        const image = result.images?.[0];
        if (image) {
            return image.startsWith('data:') ? image : `data:image/png;base64,${image}`;
        }
        throw new Error("No image data found for character reference");
    } catch (error) {
        console.error(`Failed to generate reference for ${name}`, error);
        throw error;
    }
};

export const generatePanelImage = async (
  prompt: string,
  aspectRatio: string,
  referenceImages?: { name: string, image: string }[],
  onTokenUpdate?: OnTokenUpdate,
  config?: AppConfig
): Promise<string> => {
  const ai = getAi();
  const model = await resolveImageModel(config);
  const { size, hint } = aspectRatioToSize(aspectRatio);

  const uploadedAttachmentIds: string[] = [];

  try {
    let promptPrefix = "";

    // STRICT SYSTEM PREAMBLE for image generation
    const systemPreamble = `
      SYSTEM INSTRUCTION: CHARACTER CONSISTENCY MODE [ENABLED]
      You are an expert manga artist using provided REFERENCE IMAGES to maintain perfect character identity.

      CRITICAL RULES:
      1. Reference Images are the ABSOLUTE TRUTH for character face, hair, and base outfit.
      2. If the text prompt describes the character's appearance (e.g. "white beard", "blue shirt"), CHECK if it matches the Reference Image. If it conflicts, USE THE REFERENCE IMAGE.
      3. "[VISUAL STATE]" blocks describe POSE, POSITION, and LIGHTING. They do NOT redefine the character's identity.
      4. DO NOT generate generic characters. You MUST transfer the face and style from the reference image to the new scene.
    `.trim();

    const hasRefs = !!(referenceImages && referenceImages.length > 0);

    if (hasRefs) {
        promptPrefix += systemPreamble + "\n\n";
        promptPrefix += "=== PROVIDED REFERENCE IMAGES (VISUAL ID) ===\n";

        for (let index = 0; index < referenceImages!.length; index++) {
            const ref = referenceImages![index];
            const { mimeType, buffer } = dataUrlToBuffer(ref.image);
            const attachment = await ai.attachments.upload({
                buffer,
                mimeType,
                purpose: 'vision'
            });
            uploadedAttachmentIds.push(attachment.attachmentId);

            // Add instruction linking the image to the name
            promptPrefix += `[ID_REF_${index + 1}] -> CHARACTER IDENTITY: "${ref.name}". Use this image as the exact visual model for ${ref.name}.\n`;
        }

        promptPrefix += "==============================================\n\n";
    }

    const fullTextPrompt = `${promptPrefix}SCENE DESCRIPTION:\n${prompt}\n\nOutput image aspect ratio: ${hint}.`;

    let result: { images: string[]; tokens: { inputTokens: number; outputTokens: number } };

    if (hasRefs) {
        // 带角色参考图：走 images.edit（主图 + 额外参考图，多图一致性）
        result = await ai.images.edit({
            model,
            imageAttachmentId: uploadedAttachmentIds[0],
            referenceAttachmentIds: uploadedAttachmentIds.slice(1),
            prompt: fullTextPrompt
        });
    } else {
        result = await ai.images.generate({
            model,
            prompt: fullTextPrompt,
            size,
            count: 1
        });
    }

    if (onTokenUpdate) {
         const textInputTokens = estimateTokens(fullTextPrompt);
         const imageInputTokens = (referenceImages?.length || 0) * PRICING.IMAGE_INPUT_TOKENS;
         const totalInputTokens = result.tokens?.inputTokens || (textInputTokens + imageInputTokens);
         const outputTokens = result.tokens?.outputTokens || PRICING.IMAGE_OUTPUT_TOKENS;

         onTokenUpdate({
            promptTokens: totalInputTokens,
            responseTokens: outputTokens,
            totalCost: calculateUsageCost(totalInputTokens, outputTokens, true),
            callType: 'image_gen'
         });
    }

    const image = result.images?.[0];
    if (image) {
        return image.startsWith('data:') ? image : `data:image/png;base64,${image}`;
    }

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
