// ================= tech-manga 题材主题（manga-core 融合设计 §4） =================
// 全部题材数据 1:1 平移自原 constants.ts / strings.ts 与 mulbyAiService 的硬编码段：
// - systemRole / sourceAnalysis / languageRules / refineToneHint → 原 mulbyAiService prompt 段
// - artStyles → 原 STYLE_OPTIONS（23 种画风）
// - storyModes → 原 STORY_MODES（11 种）+ STORY_MODE_PROMPTS 合并
// - characterPresets → 原 PRESET_CHARACTERS（20 个）
// - strings → 原 strings.ts 的 S 表 + 品牌键（TM / TechManga / 导出文件名前缀）
// 视觉 token 从既有样式提取（Space Grotesk 字体、indigo→purple 品牌渐变、#0f172a 深色底）。

import { StoryMode, WorkflowStep } from '@mulby-plugins/manga-core';
import type { MangaTheme } from '@mulby-plugins/manga-core';

// 画风枚举（数据随题材走，1:1 平移自原 types.ts 的 ComicStyle）
enum ComicStyle {
  MANGA_BW = 'Japanese Manga (Black & White, High Contrast)',
  AMERICAN_COMIC = 'American Comic Book (Full Color, Bold Lines)',
  PIXEL_ART = 'Pixel Art (Retro Game Style)',
  WATERCOLOR = 'Watercolor (Soft, Artistic)',
  CYBERPUNK = 'Cyberpunk (Neon, High Tech, Dark)',
  MARVEL = 'Marvel Comic',
  PAPER_CUT = 'Chinese Paper-cut Animation',
  DISNEY = '3D Disney Animation style',
  // New Styles
  GHIBLI = 'Studio Ghibli (Lush Backgrounds, Detailed Animation)',
  NOIR = 'Film Noir (High Contrast B&W, Moody, Detective)',
  BLUEPRINT = 'Technical Blueprint (Schematic, Blue/White, Engineering)',
  LIGNE_CLAIRE = 'Ligne Claire (Tintin Style, Flat Colors, Clear Outlines)',
  UKIYOE = 'Ukiyo-e (Japanese Woodblock Print, Traditional)',
  VAPORWAVE = 'Vaporwave (Retro 80s, Pink/Cyan, Glitch aesthetic)',
  CLAYMATION = 'Claymation (Aardman/Laika style, Textured)',
  LOW_POLY = 'Low Poly 3D (Angular, Minimalist, Video Game)',
  SKETCH = 'Pencil Sketch (Rough, Graphite, Hand-drawn)',
  GRAFFITI = 'Street Art Graffiti (Bold, Spray Paint, Urban)',
  STEAMPUNK = 'Steampunk (Brass, Gears, Victorian Tech)',
  ART_DECO = 'Art Deco (Elegant, Geometric, Golden Age)',
  JUNJI_ITO = 'Junji Ito Style (Horror, Detailed Lines, Uncanny)',
  CHIBI = 'Chibi / SD (Cute, Big Head, Expressive)',
  OIL_PAINTING = 'Classic Oil Painting (Textured, Rich Colors)',
  CUSTOM = 'Custom'
}

const techTheme: MangaTheme = {
  id: 'tech-manga',

  // —— Prompt 层 ——
  systemRole: 'Professional Tech Manga Director and Storyteller.',
  sourceAnalysis: `    Determine its nature:
    - **Technical Guide**? (Linear progress)
    - **Bug Report**? (Mystery/Crisis)
    - **Historical Event**? (Chronological Drama)
    - **Biography**? (Character Study)

    **ADAPT THE PLOT BASED ON THIS ANALYSIS.**
    The story structure must mirror the content's structure.`,
  languageRules: `      LANGUAGE RULE:
      - **Dialogue, Labels, and Sound Effects**: MUST be in Simplified Chinese (简体中文) unless the script specifically asks for English.
      - **Code, Technical Terms, Log Outputs**: MUST remain in English (do not translate "const", "function", "Error 404", etc.).`,
  refineToneHint: 'Ensure the terminology, tone, and logic fit the specific Universe/Fandom mentioned in the context.',

  // 故事架构段（插入核心包 system prompt 的 PHASE 3 注记与 PHASE 4 之间）：
  // 改编语境的自洽性硬约束 + 结构变体软引导 + 反套路 + 旁白克制。
  // 不动核心包既有段落；技术准确性、语言规则、图像规则均不受本段影响。
  storyCraftRules: `    ================================================================
    PHASE 3.5: STORY ARCHITECTURE (MANDATORY SELF-COHERENCE)
    ================================================================
    Before writing any page, decide the following internally, then state them explicitly in the 'analysis' field.

    **RULE 1 — ONE THREAD ONLY**:
    - The whole comic delivers EXACTLY ONE core thread: one bug's investigation, one concept's explanation, or one historical storyline.
    - **FORBIDDEN**: parallel subplots, a second unrelated lesson, or side mysteries. Every scene must serve the same thread.

    **RULE 2 — FIDELITY & CAUSALITY (ADAPTATION DISCIPLINE)**:
    - Technical facts MUST NOT contradict the Source Material. Dramatization may add personality, stakes, and humor — but never at the cost of technical accuracy.
    - Every question or mystery raised MUST be answered by the end. Every planted detail (a hint, a warning, a prop) MUST be paid off. If you plant it, you must cash it.

    **RULE 3 — GOAL-DRIVEN CAST**:
    - The 'analysis' field MUST state: the protagonist's concrete GOAL (what they try to achieve or understand) and what stands in the way.
    - Every character action must serve that goal. No "because the plot needs it" behavior.

    **RULE 4 — ANTI-CLICHÉ PASS (INTERNAL, BEFORE WRITING)**:
    - Internally list the 3 MOST clichéd adaptations for the chosen mode (e.g., "the bug is literally a monster villain", "programmers as antisocial stereotypes", "everything becomes a battlefield"), then BAN the ones that add nothing fresh. Do not write this list into the script; simply never use them.

    **RULE 5 — NARRATION RESTRAINT**:
    - Dialogue and visuals carry the story. Narration boxes are allowed ONLY for: (a) time/place transitions, (b) at most one closing line at the ending, (c) critical information that genuinely cannot be conveyed visually or in dialogue.
    - AT MOST ONE narration box per page. **FORBIDDEN**: emotion-explaining narration — show it through faces, poses, and dialogue instead.

    **STRUCTURE VARIANT (choose EXACTLY ONE)**:
    - Choose the variant that best fits the story mode and the source material, then allocate pages by the percentages below (round to whole pages):
    - **V1 Detective Arc**: Problem surfaces (0-20%) → Investigation & wrong turns (20-70%) → Root cause revealed (70-90%) → Fix & takeaway (90-100%).
    - **V2 Drama Arc**: Ordinary routine (0-25%) → Conflict escalates (25-70%) → Climax/confrontation (70-90%) → Resolution (90-100%).
    - **V3 Teaching Arc**: Hook the question (0-15%) → Build intuition step by step (15-70%) → The "aha" moment (70-90%) → Recap & apply (90-100%).
    - **V4 Chronicle Arc**: Set the era & stakes (0-25%) → Key turning points in order (25-75%) → The decisive moment (75-90%) → Aftermath & legacy (90-100%).
    - The chosen variant MUST be named in the 'analysis' field, and the page allocation must be visible in the pacing.
`,

  artStyles: [
    { label: '日漫黑白 (Manga B&W)', value: ComicStyle.MANGA_BW },
    { label: '美漫全彩 (American Comic)', value: ComicStyle.AMERICAN_COMIC },
    { label: '古典油画 (Classic Oil Painting)', value: ComicStyle.OIL_PAINTING },
    { label: '水墨国画 (Chinese Ink Wash)', value: ComicStyle.UKIYOE },
    { label: '工程蓝图 (Tech Blueprint)', value: ComicStyle.BLUEPRINT },
    { label: '宫崎骏风格 (Studio Ghibli)', value: ComicStyle.GHIBLI },
    { label: '赛博朋克 (Cyberpunk)', value: ComicStyle.CYBERPUNK },
    { label: '像素风 (Pixel Art)', value: ComicStyle.PIXEL_ART },
    { label: '黑色电影 (Film Noir)', value: ComicStyle.NOIR },
    { label: '欧式线条 (Ligne Claire)', value: ComicStyle.LIGNE_CLAIRE },
    { label: '水彩手绘 (Watercolor)', value: ComicStyle.WATERCOLOR },
    { label: '蒸汽波 (Vaporwave)', value: ComicStyle.VAPORWAVE },
    { label: '漫威风格 (Marvel Comic)', value: ComicStyle.MARVEL },
    { label: '低多边形 (Low Poly 3D)', value: ComicStyle.LOW_POLY },
    { label: '中国剪纸 (Paper-cut)', value: ComicStyle.PAPER_CUT },
    { label: '黏土动画 (Claymation)', value: ComicStyle.CLAYMATION },
    { label: '素描手稿 (Pencil Sketch)', value: ComicStyle.SKETCH },
    { label: '街头涂鸦 (Graffiti)', value: ComicStyle.GRAFFITI },
    { label: '迪士尼 (3D Disney)', value: ComicStyle.DISNEY },
    { label: '蒸汽朋克 (Steampunk)', value: ComicStyle.STEAMPUNK },
    { label: '装饰艺术 (Art Deco)', value: ComicStyle.ART_DECO },
    { label: '伊藤润二 (Junji Ito Horror)', value: ComicStyle.JUNJI_ITO },
    { label: 'Q版萌系 (Chibi/SD)', value: ComicStyle.CHIBI },
  ],

  storyModes: [
    {
      label: '💥 剧情演绎 (Action/Drama)',
      value: StoryMode.CONFLICT,
      prompt: `
    1. **Narrative Lens (Dynamic)**:
        - Analyze the input source text first.
        - **IF** the text is a "How-to Guide": The plot is a Training Arc. The Hero must master a new technique (the code) to defeat a dummy target.
        - **IF** the text is a "Bug Fix/Analysis": The plot is a Battle. The Bug is a monster/villain destroying the city. The Hero uses the fix as the finishing move.
        - **IF** the text is "Architecture/System Design": The plot is a Siege/Defense. The Hero is building a fortress (the system) to withstand an invasion (high traffic/hackers).
    
    2. **Characters (STRICT CANONICAL)**:
        - **Hero**: \${character.name}.
        - **Opponent**: A canonical villain OR a canonical rival (e.g. Vegeta/Bakugo) representing the problem.
    
    3. **Tone**: High stakes, Shonen Jump style, dramatic speeches about technical details.
        - **Recommended Structure Variant**: V2 (Drama Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '🧠 大众科普 (Science Communication)',
      value: StoryMode.SCI_COMM,
      prompt: `
    1. **Narrative Lens (Mass Education / "Cells at Work" Style)**:
        - **Goal**: Explain complex concepts to a 5-year-old or general public using **Anthropomorphism (拟人化)**.
        - **Simplicity Rule (CRITICAL)**: 
          - **NO JARGON**: Avoid professional technical terms (e.g., "Latency", "Recursion") unless absolutely necessary.
          - **Plain Language**: If a term is used, you MUST explain it immediately using everyday language.
          - **Gradual Explanation**: The logic must be step-by-step. Do not jump from A to C. Explain B. Do not be abstract.
        - **Metaphor Rule**: You MUST convert abstract technical concepts into physical objects/characters.
          - *Example*: A Database isn't a server; it's a Giant Library or a Warehouse run by a grumpy librarian.
          - *Example*: An API Request is a Mailman or a Food Delivery Courier.
          - *Example*: A Virus/Bug is a cheeky gremlin or an invader.
    
    2. **Characters (STRICT CANONICAL)**:
        - **Protagonist**: \${character.name}. They act as the "White Blood Cell" or the "Worker" executing the code.
        - **Supporting**: Canonical characters act as other system components (e.g., The Boss, The Gateway, The Storage).
    
    3. **Tone**: Educational but entertaining. Break the fourth wall. 
    
    4. **Content Density**:
        - **Dialogue First**: Each panel/page should be guided by rich dialogue; narration boxes only for transitions or what cannot be shown (see PHASE 3.5 restraint).
        - **Explanatory**: Ensure the "Why" and "How" are explained in the text bubbles, not just implied.
        - **Recommended Structure Variant**: V3 (Teaching Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '🏛️ 严肃历史 (Serious History / Documentary)',
      value: StoryMode.HISTORY_SERIOUS,
      prompt: `
    1. **Narrative Lens (Documentary / Historical Drama)**:
        - **Goal**: STRICT HISTORICAL ACCURACY. This is a serious reenactment.
        - **Source Text Handling**: Treat the input text as a historical script or record.
        - **Casting (AUTO-DETECT)**: 
            - IGNORE the user's selected 'Main Character' if it is a fictional/anime character.
            - **DETECT**: Scan the source text for the REAL historical figures (e.g., Napoleon, Cao Cao, Einstein, Ada Lovelace).
            - **ASSIGN**: In the 'character_sheet', generate descriptions based on historical paintings, photographs, or statues.
            - **Costumes**: Must be period-accurate. No anachronisms.
    
    2. **Tone**: Serious, epic, cinematic, "National Geographic" or "CCTV Documentary" style.
    
    3. **Visual & Material Culture (CRITICAL)**:
        - **Architecture**: Must match the specific era/dynasty (e.g. Victorian London vs Tang Dynasty Chang'an).
        - **Artifacts**: Weapons, tools, and furniture must be historically authentic.
        - **NO FANTASY ELEMENTS**: No magic, no sci-fi effects, no anime hair colors unless historically accurate (wigs).

    4. **Dialogue**: 
        - Use period-appropriate language (Classical Chinese for ancient China, Formal speech for Victorian era).
        - No modern slang.
        - **Recommended Structure Variant**: V4 (Chronicle Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '🎭 历史乱炖 (History Parody / Cosplay)',
      value: StoryMode.HISTORY_PARODY,
      prompt: `
    1. **Narrative Lens (The "Drunk History" / Cosplay Mashup)**:
        - **Goal**: COMEDY / MASHUP. The user's chosen Character is "Acting" as the historical figure.
        - **Concept**: A school play, a movie set, or a weird dream.
        - **Casting (ROLEPLAY)**:
            - **Main Role**: \${character.name} is CAST AS the main historical figure mentioned in the text.
            - **Visuals**: \${character.name} wearing the historical costume (e.g., Pikachu wearing Napoleon's hat and coat).
            - **Side Characters**: Other canonical characters from \${character.name}'s universe playing other historical roles.
    
    2. **Tone**: Absurd, breaking the fourth wall, funny.
    
    3. **Dialogue**: 
        - The character tries to speak the historical lines but keeps their original personality quirks (e.g., Pikachu says "Pika-Napoleon dictates...").
        - **Recommended Structure Variant**: V4 (Chronicle Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '🏫 师生教学 (Educational)',
      value: StoryMode.EDUCATIONAL,
      prompt: `
    1. **Narrative Lens (Mentorship)**:
        - Analyze the input source text.
        - **IF** text is complex theory: The setting is a Classroom or Dojo. The Mentor uses a physical analogy to explain it.
        - **IF** text is a list of mistakes: The Student is trying to do it and failing comically. The Mentor steps in to correct form.
        - **IF** text is best practices: A "Field Trip" where they observe a "Perfect System" vs a "Bad System".
    
    2. **Characters (STRICT CANONICAL)**:
        - **Mentor**: \${character.name}.
        - **Student**: A canonical sidekick/younger character (e.g., Nobita, Chopper, Genos).
    
    3. **Tone**: Patient, enlightened, emphasizing "The Why" before "The How".
        - **Recommended Structure Variant**: V3 (Teaching Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '⚔️ 异世界转生 (Isekai)',
      value: StoryMode.ISEKAI,
      prompt: `
    1. **Narrative Lens (Modern Tech as Magic)**:
        - **Concept**: The Source Code is a "Grimoire" or "Lost Spell".
        - **Adaptation**:
          - Python Script = Snake Summoning Magic.
          - Cloud Deployment = Summoning a Castle from the Sky.
          - Firewall = A literal wall of blue flames.
        - **Plot**: The Hero uses this "Ancient Cheat Code" to solve a fantasy problem (slaying a dragon, saving a village).
    
    2. **Characters (STRICT CANONICAL)**:
        - **Hero**: \${character.name} (dressed in fantasy robes/armor).
        - **Party**: Canonical friends as Mage, Warrior, Thief.
    
    3. **Tone**: Epic fantasy, magical circles, over-the-top spell chanting.
        - **Recommended Structure Variant**: V2 (Drama Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '🕵️ 悬疑推理 (Mystery)',
      value: StoryMode.MYSTERY,
      prompt: `
    1. **Narrative Lens (The Investigation)**:
        - Analyze the input source text.
        - **IF** text is debugging/tracing: A "Crime Scene". The logs are blood trails. The Hero uses a magnifying glass (debugger).
        - **IF** text is security/auth: A "Spy Thriller". An imposter is trying to sneak in. The Hero must verify identities (tokens).
        - **IF** text is data analysis: A "Puzzle Room". The Hero must arrange the clues (data) to find the truth.
    
    2. **Characters (STRICT CANONICAL)**:
        - **Detective**: \${character.name}.
        - **Suspect/Witness**: Canonical characters behaving suspiciously.
    
    3. **Tone**: Noir, shadowy, internal monologues, "There is only one truth!".
        - **Recommended Structure Variant**: V1 (Detective Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '💼 职场风云 (Office Drama)',
      value: StoryMode.OFFICE_DRAMA,
      prompt: `
    1. **Narrative Lens (The Deadline)**:
        - **Setting**: The characters are developers/PMs in a modern office (or their universe's equivalent).
        - **Adaptation**:
          - Source text is the "Client Requirement" or the "Fix needed by 5 PM".
          - Spaghetti Code = A messy filing cabinet or tangled wires.
          - Deployment = Launching a rocket.
    
    2. **Characters (STRICT CANONICAL)**:
        - **Lead**: \${character.name}.
        - **Boss/Client**: Canonical authority figure (e.g., Tsunade, Nick Fury).
    
    3. **Tone**: Stressful, coffee-fueled, relatable work struggles, triumphant release.
        - **Recommended Structure Variant**: V2 (Drama Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '🤣 爆笑喜剧 (Comedy)',
      value: StoryMode.COMEDY,
      prompt: `
    1. **Narrative Lens (The Absurd)**:
        - Analyze the input source text.
        - **Technique**: Take the technical instruction LITERALLY.
          - If the code says "kill child process", the character literally tries to attack a child character (and gets stopped).
          - If the code says "garbage collection", the character is buried in trash.
        - **Structure**: The Hero tries to implement the code -> Misunderstands it -> Chaos ensues -> Accidentally gets it right.
    
    2. **Characters (STRICT CANONICAL)**:
        - **Protagonist**: \${character.name} (acting slightly incompetent or unlucky).
        - **Straight Man**: A canonical smart character reacting with horror.
    
    3. **Tone**: Slapstick, exaggerated facial expressions, fast-paced.
        - **Recommended Structure Variant**: V2 (Drama Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '👻 惊悚恐怖 (Horror)',
      value: StoryMode.HORROR,
      prompt: `
    1. **Narrative Lens (The Glitch)**:
        - **Concept**: The code is cursed or forbidden.
        - **Adaptation**:
          - Infinite Loop = Time Loop trap.
          - Memory Leak = The room is filling with black water.
          - Recursion = Doppelgangers appearing endlessly.
    
    2. **Characters (STRICT CANONICAL)**:
        - **Victim/Survivor**: \${character.name}.
        - **The Monster**: The Bug manifested as a canonical horror/shadow.
    
    3. **Tone**: Unsettling, psychological, distorted visuals, "It's not a bug, it's a feature... of hell."
        - **Recommended Structure Variant**: V1 (Detective Arc) — recommendation, not a mandate.
  `,
    },
    {
      label: '✨ 自定义规则 (Custom)',
      value: StoryMode.CUSTOM,
      prompt: `
    1. **Narrative Approach: "User Defined"**:
        - **Instruction**: Follow the USER PROVIDED RULES below strictly.
        - **User Rules**: \${customPrompt}
    
    2. **Characters & Casting**:
        - **Main Character**: \${character.name} (\${character.description}).
        - **Casting Rule**: Adapt casting based on the user's custom scenario, but prefer existing canonical characters if possible.
  `,
    },
  ],

  characterPresets: [
    {
      name: 'Doraemon|哆啦A梦',
      description: 'From the anime "Doraemon". A blue robot cat without ears, round head, big smile, red nose. Wearing a golden bell and a magical 4D pocket on its white belly. Cute, friendly, futuristic.'
    },
    {
      name: 'Detective Conan|名侦探柯南',
      description: 'From the anime "Detective Conan". A young boy detective (Conan Edogawa), wearing a blue suit jacket, shorts, red bowtie, and large round glasses. Pointing forward confidently. Intelligent, sharp, observant.'
    },
    {
      name: 'Iron Man|钢铁侠',
      description: 'From Marvel Comics/MCU. Armored superhero in a high-tech red and gold metallic suit, glowing blue arc reactor in the chest, repulsor palms ready to fire. Heroic, futuristic, powerful.'
    },
    {
      name: 'Eren Yeager|艾伦·耶格尔',
      description: 'From the anime "Attack on Titan". A young soldier in Survey Corps uniform, short brown hair, brown jacket with "Wings of Freedom" insignia, green cape, holding dual blades. Intense, determined, ready for battle.'
    },
    {
      name: 'Judy Hopps|朱迪·霍普斯',
      description: 'From the movie "Zootopia". Anthropomorphic rabbit police officer, wearing a blue police uniform with a badge, large expressive ears, purple eyes. Energetic, optimistic, justice-seeking.'
    },
    {
      name: 'Saitama|埼玉',
      description: 'From the anime "One-Punch Man". A bald superhero, wearing a yellow bodysuit with a zipper, red gloves, red boots, and a white cape. Bland/bored expression contrasting with overwhelming power.'
    },
    {
      name: 'Anya Forger|阿尼亚·福杰',
      description: 'From the anime "SPY x FAMILY". A small girl with pink shoulder-length hair, wearing a black dress and two black horn-like hair ornaments. Green eyes, doing a "waku waku" excited expression. Cute, telepathic.'
    },
    {
      name: 'Tanjiro Kamado|灶门炭治郎',
      description: 'From the anime "Demon Slayer". A young demon slayer, burgundy hair, scar on forehead, hanafuda earrings. Wearing a green and black checkered haori over a uniform, holding a black katana. Brave, kind, water breathing effects.'
    },
    {
      name: 'Son Goku|孙悟空',
      description: 'From the anime "Dragon Ball". A Saiyan martial artist, signature spiky black hair, wearing an orange gi with a blue sash and wristbands. Muscular, energetic, gathering energy for a Kamehameha.'
    },
    {
      name: 'Calabash Brother|葫芦娃',
      description: 'From the animation "Calabash Brothers". A young heroic boy with a calabash (gourd) on his head, thick eyebrows, wearing a vest and a skirt made of leaves. Traditional, bold, magical.'
    },
    {
      name: 'Nezuko Kamado|灶门祢豆子',
      description: 'From the anime "Demon Slayer". A demon girl with fair skin, wearing a pink kimono and a bamboo muzzle over her mouth. Long black hair with orange tips, sharp nails. Protective, gentle despite demonic nature.'
    },
    {
      name: 'Totoro|龙猫',
      description: 'From the movie "My Neighbor Totoro". A large, friendly forest spirit with grey fur, round belly, and a wide grin. Carrying a leaf umbrella, standing in a grassy field. Whimsical, magical, nature-loving.'
    },
    {
      name: 'Luffy|路飞',
      description: 'From the anime "One Piece". A pirate captain with straw hat, scar under left eye, wearing red vest and blue shorts. Stretchy rubber body in a fighting stance. Adventurous, energetic, determined.'
    },
    {
      name: 'Sailor Moon|月野兔',
      description: 'From the anime "Sailor Moon". A magical girl in sailor-style uniform with blue skirt, red bow, yellow hair buns. Holding a moon scepter, sparkling magical effects. Heroic, romantic, transforming.'
    },
    {
      name: 'Winnie the Pooh|小熊维尼',
      description: 'From Disney\'s "Winnie the Pooh". A friendly, honey-loving bear with red shirt, pot belly, simple features. Holding a honey pot, sitting in Hundred Acre Wood. Simple-minded, kind-hearted, nostalgic.'
    },
    {
      name: 'Mickey Mouse|米老鼠',
      description: 'From Disney cartoons. Classic cartoon mouse with large round ears, red shorts, white gloves, yellow shoes. Waving happily, cheerful expression. Iconic, optimistic, timeless.'
    },
    {
      name: 'Harry Potter|哈利·波特',
      description: 'From the "Harry Potter" series. A young wizard with round glasses, lightning-shaped scar on forehead, wearing school robes. Holding a wand, magical sparks flying. Brave, magical, destined.'
    },
    {
      name: 'Pikachu|皮卡丘',
      description: 'From "Pokémon". An electric mouse Pokémon with yellow fur, red cheeks, black-tipped ears, lightning bolt tail. Cute, energetic, sparking with electricity.'
    },
    {
      name: 'Mulan|花木兰',
      description: 'From Disney\'s "Mulan". A Chinese warrior woman with dark hair, wearing traditional armor over hanfu, holding a sword. Determined expression, warrior spirit. Brave, honorable, strong.'
    },
    {
      name: 'Spider-Man|蜘蛛侠',
      description: 'From Marvel Comics. A superhero in tight red and blue costume with web pattern, white eye lenses. Swinging from webs between skyscrapers. Agile, heroic, youthful.'
    }
  ],

  // —— 文案层（原 strings.ts 的 S 表 + 品牌键） ——
  strings: {
    // 品牌
    brandMark: 'TM',
    brandTitleLead: 'Tech',
    brandTitleAccent: 'Manga',
    defaultComicFileName: 'TechManga_Comic',
    pageFilePrefix: 'techmanga',
    configIcon: '⚡',

    // ---- 通用 ----
    appTitleSetup: '需要完成设置',
    startOver: '重新开始',
    cancelAll: '中止全部任务',
    cancelAllTitle: '中止剧本流式生成、作废在途图像任务并清空排队任务',

    // ---- 配置面板 ----
    configTitle: '故事配置',
    sourceLabel: '源素材（文本 / 代码）',
    uploadSource: '上传 .txt/.md',
    sourcePlaceholder: '粘贴技术文档、代码片段或文章…',
    sourcePlaceholderHistory: '粘贴历史事件描述或人物传记…',
    styleLabel: '漫画画风',
    customStyleOption: '自定义画风…',
    storyModeLabel: '叙事模式',
    customStoryLabel: '自定义叙事规则',
    customStoryPlaceholder: '描述你的自定义叙事规则（例如「黑色侦探故事，Bug 是罪案…」）',
    mainCharacterLabel: '主角',
    autoDetectOption: '👥 自动识别历史人物',
    selectCharacterOption: '请选择角色',
    customCharacterOption: '自定义角色…',
    autoCastBadge: '自动选角',
    autoCastHint: '* 严肃历史模式下将从源文本自动提取真实历史人物，确保史实准确。',
    charNameLabel: '角色名',
    charDescLabel: '外观描述（发型、服装、气质）',
    pageLengthLabel: '总页数',
    panelsLabel: '每页分格',
    panelsAuto: '自动',
    panelsN: (n: number) => `${n} 格`,
    ratioLabel: '页面比例',
    generating: '正在构思你的漫画…',
    generateBtn: '生成漫画',
    estimatedInputTokens: (n: string) => `预计输入约 ${n} tokens`,
    readFileFailed: '无法读取文件，请确认文件为 UTF-8 文本。',

    // ---- 资产工作室 ----
    assetStudioTitle: '资产工作室',
    assetStudioSubtitle: '确认角色 / 道具设定，并生成风格一致的参考立绘。',
    studioTabAssets: '1. 资产工作室（角色与道具）',
    studioTabScript: '2. 剧本与分镜',
    charactersTab: (n: number) => `角色（${n}）`,
    propsTab: (n: number) => `关键道具（${n}）`,
    noReference: '暂无立绘',
    generatingLabel: '生成中…',
    generateRef: '生成立绘',
    regenerateRef: '重新生成立绘',
    generateProp: '生成道具图',
    regenerateProp: '重新生成道具图',
    uploadCustomImage: '上传自定义图片',
    noPropsFound: '剧本中未识别出关键道具。',
    noPropsHint: 'AI 没有找到需要保持一致性的重复出现物品。',
    scenesTab: (n: number) => `场景（${n}）`,
    noScenesFound: '剧本中未识别出主要场景。',
    noScenesHint: 'AI 没有找到需要保持一致性的重复出现地点。',
    generateScene: '生成场景图',
    regenerateScene: '重新生成场景图',
    sceneDescPlaceholder: '场景固定陈设、布局与光线基调描述…',
    goToScriptEditor: '保存并进入剧本编辑 →',
    charDescPlaceholder: '必须以「From [作品名]」开头，例如 "From Doraemon, a blue robot cat..."',
    propDescPlaceholder: '道具外观描述…',

    // ---- 剧本编辑器 ----
    storyboardTitle: '剧本 / 分镜编辑器',
    storyboardSubtitle: '开始绘制前，检查并润色 AI 生成的剧本。',
    startProduction: '开始绘制漫画 →',
    sidebarGlobal: '全局',
    sidebarOverview: '总览与分析',
    sidebarPages: '页面',
    sidebarCover: '00. 封面设计',
    sidebarPage: (n: string) => `${n}. 页面分镜`,
    comicTitleLabel: '漫画标题',
    analysisLabel: '故事分析与节奏策略',
    coverDesignTitle: '封面设计',
    coverPromptLabel: '封面图像 prompt',
    pageTitle: (n: number) => `第 ${n} 页`,
    layoutLabel: '分镜描述',
    fullPromptLabel: '整页图像 prompt（含视觉状态与对白）',
    fullPromptHint: '这是发给图像模型的原始指令，包含角色状态、环境细节与必须出现的中文对白。',
    charsInScene: '本页角色',
    propsInScene: '本页道具',
    noCharsInScene: '本页未列出特定角色。',
    noPropsInScene: '本页未列出关键道具。',
    includeScenes: '本页包含场景',
    scenesInScene: '本页场景',
    noScenesInScene: '本页未列出场景。',

    // ---- 名单匹配状态 ----
    unmatchedAssetHint: '未建档：该名字不在对应表中，生成时无法注入参考图',
    unmatchedCharsTitle: '未建档角色',
    unmatchedCharsHint: '以下角色名出现在剧本页面名单中，但不在角色表内。补建后可生成定妆并注入参考图。',
    addToSheetBtn: '补建',
    refinePlaceholder: '让 AI 润色这段文本（如「更有戏剧性」「修正对白」）…',
    refineBtn: 'AI 润色',
    refining: '润色中…',
    refineFailed: 'AI 润色失败，请重试',

    // ---- 漫画页 ----
    comicPagesTitle: '漫画页',
    pagesBadge: (ratio: string, n: number) => `${ratio} · 共 ${n} 页（含封面）`,
    progressBadge: (done: number, total: number) => `已完成 ${done} / ${total} 页`,
    resumeAll: (n: number) => `续绘全部未完成页（${n}）`,
    resumeAllTitle: '按并发 2 批量重发全部失败/中止页',
    exportBtn: '导出漫画',
    exportZip: 'ZIP 散图',
    exportPdf: 'PDF 文档',
    exportLong: '竖向长图',
    exporting: '正在导出…',
    exportedTo: (p: string) => `已导出到 ${p}`,
    revealInFolder: '在文件夹中显示',
    exportFailed: (m: string) => `导出失败：${m}`,
    coverBadge: '封面',
    pageBadge: (n: number) => `第 ${n} 页`,
    designingCover: '正在设计封面…',
    drawingPage: (n: number) => `正在绘制第 ${n} 页…`,
    retryPage: '重试本页',
    downloadPage: '保存本页',
    openReader: '进入阅读模式',
    editPrompt: '查看 / 编辑 prompt 与角色',
    closePrompt: '收起编辑面板',
    includeChars: '本页包含角色',
    includeProps: '本页包含道具',
    fullImagePrompt: '整页图像 prompt（含对白文本）',
    aiRefinePrompt: 'AI 润色 prompt',
    refineInputPlaceholder: '如「把背景调暗」「改成三格布局」…',
    cancelBtn: '取消',
    redrawBtn: '重新绘制本页',
    viewPromptLink: '查看 prompt 与对白',
    pageLayoutLabel: '页面布局',
    writtenBy: 'TechManga AI 出品',
    untitled: '未命名漫画',
    pageSaveFailed: (m: string) => `保存失败：${m}`,

    // ---- 生成进度 ----
    stageQueued: '排队中…',
    stageDrawing: '绘制中…',
    stageDrawingN: (r: number, t: number) => `绘制中 ${r}/${t}…`,
    stageFinalizing: '合成中…',
    stageFallback: '回退重试中…',

    // ---- 通知 ----
    notifyBatchDone: (title: string, done: number) => `《${title}》${done} 页全部生成完成`,
    notifyBatchFailed: (title: string, done: number, failed: number) =>
      `《${title}》生成结束：成功 ${done} 页 / 失败 ${failed} 页，可在卡片上单独重绘`,
    notifyScriptDone: (title: string) => `《${title}》剧本已生成，可回来确认角色设定`,

    // ---- 错误文案 ----
    pageDrawFailed: (m: string) =>
      `绘制失败：${m}。可点击「重试本页」；若持续失败，请在配置页更换图像模型（当前模型可能不支持多图参考输入）。`,
    pageAborted: '已被用户中止（可单独重绘）',

    // ---- 终端日志面板 ----
    terminalTitle: (model: string) => `AI_AGENT_TERMINAL -- ${model}`,
    defaultModelLabel: 'Mulby 默认模型',
    terminalReady: '系统就绪。',
    terminalWaiting: '等待剧本生成任务…',
    terminalStreaming: '● 流式输出中',
    terminalIdle: '○ 空闲',
    phaseScript: '生成剧本',
    phaseReview: '自动审校',

    // ---- Token 监控 ----
    taskCost: '任务费用',
    totalTokens: '累计 tokens：',
    imagesGenerated: '已生成图像：',
    costBreakdown: '按模型分组',
    recentActivity: '最近调用',
    noActivity: '暂无调用记录。',
    estimatedBadge: '估算',
    unpricedCalls: (n: number) => `另有 ${n} 次未计价调用`,
    unpricedRow: '未计价',

    // ---- Phase 2：副故事模式 / 结局 / 水印（tech 主题三个开关全关，仅为接口完整提供） ----
    secondaryStoryModeLabel: '副故事模式（混合）',
    secondaryStoryModeNone: '无（纯主模式）',
    endingLabel: '结局类型',
    colorModeLabel: '色彩模式',
    watermarkTitle: '水印设置',
    watermarkEnable: '启用水印',
    watermarkTypeLabel: '水印类型',
    watermarkTextLabel: '水印文字',
    watermarkTextPlaceholder: '如 @你的名字',
    watermarkImageLabel: '水印图片',
    watermarkUploadImage: '上传图片',
    watermarkChangeImage: '更换图片',
    watermarkOpacityLabel: '不透明度',
    watermarkPageTitle: (n: number) => `本页水印（第 ${n} 页）`,
    watermarkModeLabel: '模式',
    watermarkModeGlobal: '跟随全局',
    watermarkModeCustom: '本页自定义',

    // ---- 工程画廊（多工程管理） ----
    myProjects: '我的工程',
    continueLastProject: '继续上次创作',
    projectUntitled: (date: string) => `未命名工程 ${date}`,
    galleryEmpty: '还没有工程。生成一部漫画后，工程会自动出现在这里。',
    galleryOpen: '打开',
    galleryRename: '重命名',
    galleryRenameSave: '保存',
    galleryDelete: '删除',
    galleryDeleteConfirm: '确认删除？',
    galleryExport: '导出 ZIP',
    galleryExportNoPages: '该工程还没有已生成的页面。',
    galleryUpdatedAt: (d: string) => `更新于 ${d}`,
    projectPages: (done: number, total: number) => `${done}/${total} 页`,
    projectStageLabel: (step: WorkflowStep) =>
      step === WorkflowStep.COMIC_GENERATION ? '绘制阶段' : '分镜阶段',
    projectOpenFailed: '打开工程失败：数据缺失或已损坏。',
    projectOpenRetry: '打开工程失败，可重试。',

    // ---- 返回上一步 ----
    backButton: '上一步',
    backAbortMessage: '返回上一步将中止正在生成的页面',
    backAbortDetail: (done: number) => `已完成的 ${done} 页图像会保留，可稍后继续绘制。`,
    backAbortConfirm: '中止并返回',

    // ---- 剧本自动审校（C）与意见迭代（D） ----
    autoReviewLabel: '剧本自动审校',
    autoReviewHint: '生成剧本后，由「总编辑」模型按逻辑/动机/伏笔/旁白密度清单自动修订一遍',
    feedbackPlaceholder: '对剧本的修改意见，如「加强结尾反转」「减少旁白框」…',
    feedbackSubmit: '按意见修订',
    feedbackSubmitting: '修订中…',
    reviseFailed: '剧本修订失败，请重试',
    reviseRedrawHint: '剧本已更新；已生成的页面不会自动重绘，可在页面卡片上逐页重绘',
  },

  // —— 视觉层（从既有样式提取：Space Grotesk 字体、indigo→purple 品牌渐变、#0f172a 深色底） ——
  ui: {
    fontFamily: "'Space Grotesk', sans-serif",
    accent: '#6366f1',          // indigo-500
    accentSecondary: '#9333ea', // purple-600
    ctaFrom: '#4f46e5',         // indigo-600（原 from-indigo-600）
    ctaTo: '#9333ea',           // purple-600（原 to-purple-600）
    ctaHoverFrom: '#6366f1',    // indigo-500（原 hover:from-indigo-500）
    ctaHoverTo: '#a855f7',      // purple-500（原 hover:to-purple-500）
    colorScheme: 'dark',
    background: '#0f172a',
    text: '#f1f5f9',            // slate-100
  },

  features: {
    watermark: false,
    endings: false,
    secondaryStoryMode: false,
    props: true,
  },
};

export default techTheme;
