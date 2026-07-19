// ================= horror-manga 题材主题（manga-core 融合设计 §4/§6 Phase 3） =================
// 全部题材数据 1:1 平移自原 types.ts（HorrorStyle/StoryMode/EndingType/ColorMode 枚举）、
// constants.ts（STYLE_OPTIONS/STORY_MODES/STORY_MODE_PROMPTS/ENDING_TYPE_OPTIONS 等）、
// services/mulbyAiService.ts（constructSystemPrompt + getJsonSchemaString 逐字搬迁为 buildScriptPrompt）、
// App.tsx / ConfigPanel / PanelCard / ScriptReviewPanel 的界面文案与红黑视觉。
// 引擎机制（持久化 / 中止纪元 / 附件缓存 / JSON 修复 / 并发池 / 导出三格式）全部由核心包提供。

import { WatermarkType } from '@mulby-plugins/manga-core';
import type { MangaTheme, StoryModeOption, EndingOption, ColorModeOption, LabeledOption } from '@mulby-plugins/manga-core';

// ---------- 14 种大师画风（原 types.ts HorrorStyle，逐字保留大段描述） ----------
enum HorrorStyle {
  JUNJI_ITO = `Junji Ito Style. 
    [Art]: Black and white ink. Obsessive fine lines, dense cross-hatching, spirals and impossible geometry. Body horror with uncanny beauty transforming into grotesque. High contrast, clinical yet nightmare-inducing atmosphere. Meticulous detail in mundane objects that become sinister.
    [Story]: Slow-burn cosmic dread. Ordinary life invaded by obsessive, unexplainable phenomena. Characters become consumed by fixations (spirals, holes, beauty). Themes: obsession, contamination, loss of identity, body autonomy violated. No clear resolution—horror lingers. Victims rarely escape; acceptance of doom.
    [Tone]: Creeping unease escalating to visceral shock. Beauty and disgust intertwined.
    [Reference]: Uzumaki, Tomie, The Enigma of Amigara Fault, Gyo.`,

  KAZUO_UMEZU = `Kazuo Umezu Style. Retro 70s Horror Manga.
    [Art]: Heavy bold ink lines, extreme exaggerated facial expressions (bulging eyes with visible whites, wide screaming mouths with visible uvula), grotesque physical transformations. High contrast dramatic shadows. Slightly cartoonish characters against horrific situations creates dissonance.
    [Story]: Apocalyptic survival horror. Children as protagonists facing adult nightmares. Social collapse, paranoia, mob mentality. Themes: loss of innocence, betrayal, human cruelty worse than monsters, survival guilt. Endings often bleak or bittersweet. Fast-paced panic and hysteria.
    [Tone]: Hysterical terror, primal screaming fear. Emotional intensity at maximum.
    [Reference]: The Drifting Classroom, Orochi, The Left Hand of God Right Hand of the Devil, Cat Eyed Boy.`,

  HIDESHI_HINO = `Hideshi Hino Style. Grotesque and Surreal.
    [Art]: Bulging perfectly round eyes (often bloodshot or hollow), rotting flesh rendered with loving detail, decay, maggots, larvae, viscera. Characters look like distinct oddities—misshapen heads, asymmetric features. Rough, visceral ink work with scratchy, almost childlike quality. Thick uneven outlines.
    [Story]: Outcasts and freaks as protagonists. Bullied children, social rejects, the deformed. Dark humor mixed with genuine tragedy. Revenge fantasies that go too far. Themes: alienation, the monster inside us, cycles of abuse, finding beauty in ugliness. Often autobiographical undertones of childhood trauma.
    [Tone]: Tragicomic grotesque. Pity and disgust in equal measure. Carnival of the damned.
    [Reference]: Panorama of Hell, Hell Baby, Bug Boy, Red Snake.`,

  HITOSHI_IWAAKI = `Hitoshi Iwaaki Style (Parasyte-inspired).
    [Art]: Clean, precise, almost clinical lines. Detailed realistic anatomy that suddenly becomes alien. Body horror involving flesh splitting like flower petals, blade-like appendages, fluid shapeshifting biomass. Cold, emotionless expressions on parasitic entities vs intense fear/determination on humans. Dynamic action poses with clear motion lines.
    [Story]: Sci-fi body horror with philosophical depth. Symbiosis, identity crisis (what makes us human?). Parasitic invasion narratives. Themes: coexistence, evolution, environmental critique, loss of humanity. Protagonist forced to coexist with the monster. Moral ambiguity—monsters can be more "human" than humans.
    [Tone]: Cold, cerebral horror punctuated by explosive violence. Scientific detachment.
    [Reference]: Parasyte (Kiseijuu), Historie.`,

  KOJI_MATSUMOTO = `Koji Matsumoto Style (Higanjima-inspired). Gritty Survival Horror.
    [Art]: Rough, sketchy lines with heavy shading and crosshatching. Detailed decrepit environments—abandoned villages, dark forests, ruined buildings. Vampires with monstrous transformations, giant aberrant creatures. Dirty, sweaty, bloodied characters. Unpolished, almost B-movie aesthetic.
    [Story]: Siege survival against overwhelming vampire hordes. Band of brothers/desperate survivors bonding through trauma. Escalating threats—each enemy bigger and worse. Themes: brotherhood, sacrifice, losing humanity to survive, rescue missions gone wrong. Pulpy action-horror with splatter violence. Tonal whiplash between horror and absurd humor.
    [Tone]: Grindhouse survival. Exhaustion, desperation, and unlikely heroism.
    [Reference]: Higanjima, Revenge of the Grotesque (stylistic cousins).`,

  SHINICHI_KOGA = `Shinichi Koga Style (Eko Eko Azarak). Occult & Witchcraft Horror.
    [Art]: Retro Shoujo Horror aesthetic. Dark heavy shadows with stark contrast. Mystical symbols, pentagrams, ritual circles rendered in detail. Beautiful witch protagonist with cold, knowing eyes and flowing dark hair. Gothic atmosphere—candles, full moons, old mansions. Elegant yet sinister character designs.
    [Story]: Episodic curse-of-the-week structure. Black magic used for justice/revenge. School setting with dark secrets. Protagonist as morally ambiguous witch dispensing supernatural karma. Themes: karmic retribution, forbidden knowledge, consequences of wishes, female power in patriarchal settings. Each chapter: setup transgression → invoke curse → ironic punishment.
    [Tone]: Gothic elegance meets cruel justice. Cool, detached, almost sadistic satisfaction.
    [Reference]: Eko Eko Azarak, Hino-san's Book of Bugs (spiritual successor vibes).`,

  RENSUKE_OSHIKIRI = `Rensuke Oshikiri Style (Misu Misou-inspired). Psychological Torment Horror.
    [Art]: Rough, almost scribbled sketch style—deliberately unfinished looking. Hollow dead eyes on trauma victims, ghostly motion blurs, sudden visceral violence with detailed gore contrasting loose backgrounds. Dreamy soft panels shattered by nightmare imagery. Heavy use of white space and emptiness.
    [Story]: Extreme bullying/ijime narratives escalating to revenge. Psychological breakdown in minute detail. Rural isolation amplifying horror. Themes: systemic cruelty, complicit adults, the breaking point, revenge as self-destruction, trauma cycles. Slow descent then explosive catharsis. Villains are ordinary humans being casually monstrous.
    [Tone]: Suffocating despair punctuated by cathartic ultraviolence. Numb dissociation.
    [Reference]: Misu Misou (A Cruel God Reigns), Yuureitou, Boku wa Mari no Naka (psychological elements).`,

  MASAAKI_NAKAYAMA = `Masaaki Nakayama Style (Fuan no Tane). Uncanny Valley Horror.
    [Art]: Hyper-realistic distortions in completely mundane settings. Warped faces—too wide smiles, unblinking eyes, wrong proportions on otherwise normal people. Ghosts hiding in plain sight (background figures, reflections, crowds). High contrast black and white. Heavy use of negative space. Realistic environments (apartments, schools, trains) with ONE wrong thing.
    [Story]: Ultra-short format urban legend style. Vignettes of everyday people encountering the inexplicable. NO explanation given—horror comes from not knowing. Themes: paranoia, the seen/unseen, violation of safe spaces, "it was always there." Endings often ambiguous or abrupt—reader left to imagine the worst.
    [Tone]: Lingering dread. The moment before the jumpscare, frozen forever. Quiet, creeping paranoia.
    [Reference]: Fuan no Tane (Seeds of Anxiety), Fuan no Tane+, Kouishou Radio.`,

  AMERICAN_HORROR = `Classic American Horror Comic (EC Comics Era).
    [Art]: Bold pulp aesthetic, heavy spotted blacks with dramatic chiaroscuro lighting. Thick confident contour lines. Dynamic "camera angles"—extreme low shots, Dutch angles. Grotesque monsters rendered with gleeful detail—rotting zombies, cackling ghouls, vampires. Expressive, almost theatrical character poses. Vivid if colored (sickly greens, blood reds).
    [Story]: Anthology format with twist endings. Morality tales with karmic punishment. Sinners get gruesome comeuppance. Host characters (Crypt Keeper, Vault Keeper) providing sardonic commentary. Themes: greed punished, murderers murdered by victims, poetic justice, dark humor. Setup → crime → ironic supernatural revenge. Puns in titles and dialogue.
    [Tone]: Campy, ghoulish fun. Gleeful macabre with moral satisfaction. Gallows humor.
    [Reference]: Tales from the Crypt, Vault of Horror, Creepshow, House of Mystery.`,

  CHINESE_FOLKLORE = `Chinese Folklore Horror (Manhua Style). Taoist Supernatural.
    [Art]: Traditional ink wash painting influence blended with sharp horror manga elements. Paper money (joss paper), Jiangshi (hopping vampires in Qing dynasty robes), burning incense, ancient villages with curved rooftops, red elements if colored (lanterns, wedding dress, blood), eerie fog/mist. Talismans, peachwood swords, bagua mirrors as protective items.
    [Story]: Taoist exorcist narratives. Ghost marriages, vengeful spirits (yuanmu), hungry ghosts, fox spirits. Rural settings with ancient grudges. Themes: filial piety violated, improper burials, ancestral sins, forbidden love across life/death. Rituals and rules-based magic systems. Often tragic backstories for ghosts.
    [Tone]: Melancholic supernatural. Tragedy of the dead, duty of the living. Atmospheric dread.
    [Reference]: Mr. Vampire films (visual), Mo Xiang Tong Xiu works (story), Chinese urban legends.`,

  KOREAN_WEBTOON = `Korean Horror Webtoon Style. Digital Vertical Horror.
    [Art]: Desaturated muted colors (grays, pale skin) with sudden VIVID red blood as shock. Smooth clean digital linework. Long vertical panels exploiting scroll format—reader "falls" into horror. Extreme close-ups of twisted faces (bulging eyes, too-wide smiles, distorted features). Modern urban settings—apartments, subways, offices.
    [Story]: Modern social horror. Themes: academic pressure, workplace bullying, beauty standards, social media anxiety, apartment isolation. Monsters as metaphors for social ills. Jump scare pacing—quiet panels then SUDDEN full-screen horror face. Body transformation horror. Often survival scenarios in contained spaces.
    [Tone]: Anxious modern dread exploding into visceral shock. The horror of contemporary life.
    [Reference]: Sweet Home, Bastard, Tales of the Unusual, Chiller, 0.0MHz.`,

  REALISTIC_GHOST = `Found Footage / Photorealistic Horror Style.
    [Art]: Simulated low-quality media—blurry, grainy, low-light green night vision, surveillance camera aesthetic. Amateur "camera" angles—shaky, off-center, partially obscured views. Motion blur on movement. Unclear figures in deep background or periphery. Photo-manipulation feel. Realistic environments with ONE anomaly.
    [Story]: Documentary/investigation framing. Characters reviewing footage, exploring abandoned locations. Horror of the UNSEEN—glimpses, suggestions, "did you see that?" The audience sees more than characters. Themes: obsessive documentation, violation of forbidden spaces, the gaze being returned, technology failing. Ambiguous whether supernatural or psychological.
    [Tone]: Voyeuristic dread. The horror of almost-seeing. Realistic mundanity violated.
    [Reference]: The Blair Witch Project, Paranormal Activity, [REC], SCP Foundation logs.`,

  LOVECRAFTIAN = `Lovecraftian Cosmic Horror Style.
    [Art]: Detailed engraving/etching aesthetic with obsessive linework. Impossible non-Euclidean geometry—architecture that shouldn't exist. Massive incomprehensible scale—humans as specks against vast entities. Tentacles, too many eyes, forms that hurt to perceive. Fog, ancient ruins, underwater/underground settings. Elder signs, occult tomes.
    [Story]: Forbidden knowledge narratives. Investigators uncovering truths that destroy sanity. Ancient beings older than humanity, indifferent to our existence. Themes: insignificance of humanity, dangerous curiosity, madness as enlightenment, cults worshipping the incomprehensible. NO defeating the horror—only survival or succumbing. Unreliable narrators losing grip on reality.
    [Tone]: Existential dread. Awe and terror at human irrelevance. Sanity-eroding revelation.
    [Reference]: H.P. Lovecraft works, Junji Ito's cosmic works, Bloodborne aesthetic, The Call of Cthulhu.`,

  SILENT_HORROR = `Silent Horror / Pure Visual Storytelling Style.
    [Art]: NO TEXT BUBBLES OR NARRATION. Pure sequential visual narrative. Cinematic panel composition—establishing shots, reaction shots, extreme close-ups. Heavy focus on environmental storytelling (objects, background details tell story). Character expression and body language carry all emotion. Atmospheric lighting as narrative device.
    [Story]: Show, don't tell philosophy. Ambiguous narratives open to interpretation. Focus on universal fears transcending language. Slow-burn tension through pacing—many small panels building to full-page reveals. Themes best conveyed visually: pursuit, transformation, discovery, loss. Mystery maintained through what's NOT shown.
    [Tone]: Suffocating tension. The weight of silence. Reader becomes active interpreter.
    [Reference]: Gou Tanabe's Lovecraft adaptations, Emily Carroll's works, Nicolas Delort, Thomas Ott.`,

  CUSTOM = 'Custom Style - User defined parameters for art style, story themes, tone, and reference works.'
}

// ---------- 9 种故事模式（原 types.ts StoryMode） ----------
enum StoryMode {
  PSYCHOLOGICAL = 'Psychological',
  SLASHER = 'Slasher/Gore',
  GHOST = 'Supernatural/Ghost',
  BODY_HORROR = 'Body Horror',
  COSMIC = 'Cosmic Horror',
  TECH_HORROR = 'Tech/Cyber Horror',
  FOLK_HORROR = 'Folk/Rural Horror',
  SURVIVAL = 'Survival/Siege',
  MONSTER = 'Monster/Kaiju'
}

// ---------- 6 种结局（原 types.ts EndingType） ----------
enum EndingType {
  TRAGEDY = 'Tragedy (Everyone Dies/Fails)',
  OPEN = 'Open/Ambiguous (Horror Continues)',
  TWIST = 'Shock Twist (The Truth Revealed)',
  LOOP = 'Infinite Loop (It Never Ends)',
  RELIEF = 'Relief/Escape (Survivor)',
  PYRRHIC = 'Pyrrhic Victory (Won but Cost Everything)'
}

// ---------- 色彩模式（原 types.ts ColorMode） ----------
enum ColorMode {
  BLACK_AND_WHITE = 'Black and White (Manga Ink)',
  FULL_COLOR = 'Full Color (Webtoon/Comic)'
}

// ---------- 模式下拉 + 叙事 prompt（原 constants.ts STORY_MODES / STORY_MODE_PROMPTS） ----------
const STORY_MODE_DATA: StoryModeOption[] = [
  {
    label: '心理恐怖 (Psychological)',
    value: StoryMode.PSYCHOLOGICAL,
    prompt: `
    1. **Narrative Approach: "Unreliable Narrator"**:
        - **Atmosphere**: Paranoia, Claustrophobia, Distortion.
        - **Visual Focus**: Close-ups on eyes, sweating faces, distorted perspectives. The horror is in the mind.
        - **Pacing**: Slow build-up -> Confusion -> Break from Reality.
        - **Turning Point Suggestions**:
            a. The protagonist realizes they are talking to someone who isn't there.
            b. A familiar room suddenly has different dimensions or doors.
            c. The protagonist wakes up, but the nightmare continues (false awakening).
        - **Technique**: Use "Dutch Angles" and impossible geometries to unsettle the viewer.
  `,
  },
  {
    label: '血腥砍杀 (Slasher/Gore)',
    value: StoryMode.SLASHER,
    prompt: `
    1. **Narrative Approach: "The Hunt"**:
        - **Structure**: The Warning -> The Chase -> The Confrontation -> The Survivor.
        - **Atmosphere**: Adrenaline, Shadows, Visceral Imagery.
        - **Visual Focus**: Weapons, movement lines, fluid splatters, the Killer's silhouette.
        - **Pacing**: Fast, intense, action-oriented.
        - **Turning Point Suggestions**:
            a. The weapon breaks or jams at a critical moment.
            b. The "safe place" (police car, locked room) is already compromised.
            c. The killer is revealed to be someone trusted.
  `,
  },
  {
    label: '灵异鬼怪 (Ghost Story)',
    value: StoryMode.GHOST,
    default: true, // 原 INITIAL_CONFIG.storyMode = GHOST
    prompt: `
    1. **Narrative Approach: "The Haunting"**:
        - **Structure**: Discovery -> Escalation -> Manifestation.
        - **Atmosphere**: Cold, Silent, Eerie.
        - **Visual Focus**: Background details (faces in windows), shadows that move, negative space.
        - **Technique**: "The Unseen" - imply presence rather than showing the monster immediately.
        - **Turning Point Suggestions**:
            a. An old photograph reveals the ghost was always watching.
            b. The protective charm/talisman is actually what summoned the ghost.
            c. The ghost isn't haunting the house; it's attached to the protagonist.
  `,
  },
  {
    label: '身体变异 (Body Horror)',
    value: StoryMode.BODY_HORROR,
    prompt: `
    1. **Narrative Approach: "The Metamorphosis"**:
        - **Structure**: Infection -> Symptom -> Transformation -> Loss of Self.
        - **Atmosphere**: Uncanny, Painful, Visceral.
        - **Visual Focus**: Flesh textures, unnatural joints, melting, holes, fusion of organic and mechanical.
        - **Technique**: Detailed focus on anatomical corruption.
        - **Turning Point Suggestions**:
            a. The protagonist tries to cut off the infected part, but it acts defensively.
            b. The "cure" accelerates the mutation.
            c. The protagonist realizes the mutation is an "improvement" or evolution.
  `,
  },
  {
    label: '未知恐惧 (Cosmic Horror)',
    value: StoryMode.COSMIC,
    prompt: `
    1. **Narrative Approach: "Insignificant Humanity"**:
        - **Structure**: Curiosity -> Forbidden Knowledge -> Madness.
        - **Atmosphere**: Oppressive, Ancient, Massive.
        - **Visual Focus**: Giant scale entities vs tiny humans, fog, tentacles, non-Euclidean geometry.
        - **Technique**: Emphasize the sheer scale of the horror.
        - **Turning Point Suggestions**:
            a. The "stars" in the sky blink.
            b. Translating the ancient text reveals the reader's own name.
            c. The monster doesn't attack; it ignores the protagonist because they are like an ant.
  `,
  },
  {
    label: '科技惊悚 (Tech/Cyber)',
    value: StoryMode.TECH_HORROR,
    prompt: `
    1. **Narrative Approach: "The Glitch"**:
        - **Structure**: Innovation -> Glitch -> Malevolence -> Domination.
        - **Atmosphere**: Cold, Digital, Artificial, Strobe-lighting.
        - **Visual Focus**: Screens, wires, pixels, uncanny deepfakes, metal fusing with flesh.
        - **Technique**: Use screen interfaces as panels. Text bubbles can be code or error messages.
        - **Turning Point Suggestions**:
            a. The AI predicts the protagonist's death with 100% accuracy.
            b. The reflection in the screen moves independently.
            c. The "off" switch doesn't work; the device is powered by something else.
  `,
  },
  {
    label: '民俗恐怖 (Folk/Rural)',
    value: StoryMode.FOLK_HORROR,
    prompt: `
    1. **Narrative Approach: "The Old Ways"**:
        - **Structure**: Arrival -> Observation of Rituals -> Violation of Taboo -> Sacrifice.
        - **Atmosphere**: Pastoral, Sunny but sinister, Ancient, Cult-like.
        - **Visual Focus**: Masks, nature, harvest, stone circles, smiling villagers.
        - **Technique**: Contrast beautiful scenery with horrific acts (Daylight Horror).
        - **Turning Point Suggestions**:
            a. The "festival food" is revealed to be... something else.
            b. The villagers stop smiling all at once.
            c. The protagonist realizes they are not the guest, but the main course.
  `,
  },
  {
    label: '极限生存 (Survival)',
    value: StoryMode.SURVIVAL,
    prompt: `
    1. **Narrative Approach: "The Siege"**:
        - **Structure**: Isolation -> The Attack -> Defense Fails -> Last Stand.
        - **Atmosphere**: Claustrophobic, Desperate, Gritty.
        - **Visual Focus**: Barricades, improvised weapons, wounds, sweat, exhaustion.
        - **Technique**: Emphasize resource scarcity and ticking clock.
        - **Turning Point Suggestions**:
            a. The rescue signal was faked by the enemy.
            b. One of the survivors is hiding a bite/infection.
            c. The barricade holds, but the threat is coming from the floor/ceiling.
  `,
  },
  {
    label: '巨型怪物 (Monster/Kaiju)',
    value: StoryMode.MONSTER,
    prompt: `
    1. **Narrative Approach: "The Beast"**:
        - **Structure**: Rumors -> Footprints/Damage -> First Sighting -> Rampage.
        - **Atmosphere**: Loud, Destructive, Apex Predator.
        - **Visual Focus**: Scale, teeth, claws, destruction of environment.
        - **Technique**: Show the aftermath before showing the monster.
        - **Turning Point Suggestions**:
            a. It's not one monster; it's a pack/swarm.
            b. The monster is the mother looking for its stolen egg (which the protagonist has).
            c. Conventional weapons make it stronger/larger.
  `
  },
];

const STORY_MODE_PROMPTS: Record<string, string> = {};
for (const m of STORY_MODE_DATA) STORY_MODE_PROMPTS[m.value] = m.prompt;

// ---------- 结局下拉（原 constants.ts ENDING_TYPE_OPTIONS；TWIST 为原默认） ----------
const ENDINGS: EndingOption[] = [
  { label: '悲剧结局 (Total Tragedy)', value: EndingType.TRAGEDY },
  { label: '惊天反转 (Shock Twist)', value: EndingType.TWIST, default: true },
  { label: '开放式 (Ambiguous/Open)', value: EndingType.OPEN },
  { label: '无限循环 (Infinite Loop)', value: EndingType.LOOP },
  { label: '逃出生天 (Relief/Escape)', value: EndingType.RELIEF },
  { label: '惨胜 (Pyrrhic Victory)', value: EndingType.PYRRHIC },
];

// ---------- 色彩模式（原 COLOR_MODE_OPTIONS + 图像 prompt 关键词；B&W 为原默认） ----------
const COLOR_MODES: ColorModeOption[] = [
  {
    label: 'Black & White (Traditional Manga)',
    value: ColorMode.BLACK_AND_WHITE,
    promptHint: 'monochrome, manga style, screentones, black and white ink illustration, high contrast, noir',
    default: true,
  },
  {
    label: 'Full Color (Webtoon Style)',
    value: ColorMode.FULL_COLOR,
    promptHint: 'full color, vivid colors, cinematic lighting, detailed color illustration',
  },
];

// ---------- 比例 / 页数下拉（原 ASPECT_RATIOS / PAGE_LENGTH_OPTIONS 英文标签） ----------
const ASPECT_RATIO_OPTIONS: LabeledOption[] = [
  { label: '2:3 (Manga Page)', value: '2:3' },
  { label: '3:4 (Portrait)', value: '3:4' },
  { label: '1:1 (Square)', value: '1:1' },
  { label: '4:3 (Landscape)', value: '4:3' },
  { label: '16:9 (Cinematic)', value: '16:9' },
];

const PAGE_LENGTH_OPTIONS: LabeledOption[] = [
  { label: 'Short (3-5 Pages)', value: 'Short' },
  { label: 'Medium (6-10 Pages)', value: 'Medium' },
  { label: 'Long (11-15 Pages)', value: 'Long' },
];

// ---------- 剧本 system prompt（原 mulbyAiService.constructSystemPrompt 逐字搬迁） ----------
const constructSystemPrompt = (
  style: string,
  storyMode: string,
  panelCount: number,
  totalPages: string,
  secondaryStoryMode?: string,
  endingType?: string,
  colorMode?: string
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
      narrativeInstructions += `\n\n**CROSS-OVER INSTRUCTION**: You must blend the themes of the Primary Genre with the tropes of the Secondary Genre. For example, ${horrorTheme.secondaryModeBlendExample}.`;
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
// （原 mulbyAiService.getJsonSchemaString 逐字搬迁）
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

// API 级 JSON schema 约束（形状与上面的文字版一致；核心包默认 schema 含 prop_sheet，不适用于本题材）
const HORROR_JSON_SCHEMA = {
  type: 'object',
  required: ['title', 'global_art_style', 'analysis', 'character_sheet', 'cover_image_prompt', 'pages'],
  properties: {
    title: { type: 'string' },
    global_art_style: { type: 'string' },
    analysis: { type: 'string' },
    character_sheet: {
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
        required: ['page_number', 'characters_in_scene', 'layout_description', 'image_prompt'],
        properties: {
          page_number: { type: 'integer' },
          characters_in_scene: { type: 'array', items: { type: 'string' } },
          layout_description: { type: 'string' },
          image_prompt: { type: 'string' },
          persistent_states: {
            type: 'object',
            properties: {
              characters: {
                type: 'array',
                items: {
                  type: 'object',
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
        },
      },
    },
  },
} as const;

// ================= MangaTheme 组装 =================
const horrorTheme: MangaTheme = {
  id: 'horror-manga',

  // —— Prompt 层 ——
  // 本题材经 buildScriptPrompt 整体自定义剧本 prompt（constructSystemPrompt 逐字搬迁），
  // 以下四个字段供默认路径兜底/数据完整；refineText 的语气提示使用恐怖基调。
  systemRole: 'Professional Horror Manga Artist and Storyteller.',
  sourceAnalysis: `    Determine the horror vector: ghost, killer, curse, madness, or the unknown.

    **ADAPT THE PLOT BASED ON THIS ANALYSIS.**
    The story structure must mirror the content's structure.`,
  languageRules: `      LANGUAGE RULE:
      - **Dialogue, Labels, and Sound Effects**: MUST be in Simplified Chinese (简体中文). Do NOT include English translations in parentheses.`,
  refineToneHint: 'Maintain the horror tone.',
  artStyles: [
    { label: '伊藤润二风 (Junji Ito - Spirals & Obsession)', value: HorrorStyle.JUNJI_ITO },
    { label: '中山昌亮风 (Masaaki Nakayama - Fuan no Tane/Uncanny)', value: HorrorStyle.MASAAKI_NAKAYAMA },
    { label: '楳图一雄风 (Kazuo Umezu - Retro Grotesque)', value: HorrorStyle.KAZUO_UMEZU },
    { label: '日野日出志风 (Hideshi Hino - Decay & Rot)', value: HorrorStyle.HIDESHI_HINO },
    { label: '岩明均风 (Hitoshi Iwaaki - Parasyte/Cold Body Horror)', value: HorrorStyle.HITOSHI_IWAAKI },
    { label: '押切莲介风 (Rensuke Oshikiri - Misu Misou/Psychological)', value: HorrorStyle.RENSUKE_OSHIKIRI },
    { label: '松本光司风 (Koji Matsumoto - Higanjima/Gritty Survival)', value: HorrorStyle.KOJI_MATSUMOTO },
    { label: '古贺新一风 (Shinichi Koga - Eko Eko Azarak/Occult)', value: HorrorStyle.SHINICHI_KOGA },
    { label: '中式民俗恐怖 (Chinese Folklore - Paper Money/Taoist)', value: HorrorStyle.CHINESE_FOLKLORE },
    { label: '韩式条漫恐怖 (Korean Webtoon - Jump Scare)', value: HorrorStyle.KOREAN_WEBTOON },
    { label: '美式恐怖漫画 (American Pulp/Tales from the Crypt)', value: HorrorStyle.AMERICAN_HORROR },
    { label: '无声恐怖 (Silent Horror - Pure Visuals)', value: HorrorStyle.SILENT_HORROR },
    { label: '伪纪录片风 (Found Footage/Realistic)', value: HorrorStyle.REALISTIC_GHOST },
    { label: '克苏鲁神话 (Lovecraftian/Cosmic)', value: HorrorStyle.LOVECRAFTIAN },
  ],
  storyModes: STORY_MODE_DATA,
  characterPresets: [], // 恐怖题材无预设角色：剧本自动分析并生成角色（原实现即全自动选角）
  endings: ENDINGS,
  secondaryModeBlendExample: 'if blending "Ghost" with "Tech", create a digital haunting or AI ghost',
  colorModes: COLOR_MODES,
  aspectRatioOptions: ASPECT_RATIO_OPTIONS,
  pageLengthOptions: PAGE_LENGTH_OPTIONS,

  // 剧本 prompt 整体自定义（与核心包默认结构差异过大：变量全在 system 段，user 仅源文本）
  buildScriptPrompt: (input) => ({
    system: constructSystemPrompt(
      input.style,
      input.storyMode,
      input.panelCount,
      input.totalPages,
      input.secondaryStoryMode,
      input.endingType,
      input.colorMode
    ) + "\n\n" + getJsonSchemaString(),
    user: `Source Story:\n"""\n${input.sourceText}\n"""`,
  }),
  jsonSchema: HORROR_JSON_SCHEMA,

  watermark: {
    defaults: {
      enabled: false,
      type: WatermarkType.TEXT_TILED,
      text: '单细胞漫画',
      image: null,
      opacity: 0.3,
    },
    fallbackText: 'HorrorManga',
    typeOptions: [
      { label: 'Text: Tiled (Diagonal)', value: WatermarkType.TEXT_TILED },
      { label: 'Text: Bottom Corner', value: WatermarkType.TEXT_CORNER },
      { label: 'Image: Center (Large)', value: WatermarkType.IMAGE_CENTER },
      { label: 'Image: Bottom Corner', value: WatermarkType.IMAGE_CORNER },
    ],
  },

  // —— 文案层（按原 UI 逐屏文案填写；核心包新增能力用同风格文案补齐） ——
  strings: {
    // 品牌
    brandMark: 'HM',
    brandTitleLead: 'HORROR',
    brandTitleAccent: 'MANGA',
    defaultComicFileName: 'HorrorManga',
    pageFilePrefix: 'horrormanga',
    configIcon: '🩸',

    // ---- 通用 ----
    appTitleSetup: 'SETUP REQUIRED',
    startOver: 'START OVER',
    cancelAll: 'CANCEL RITUAL',
    cancelAllTitle: '中止剧本流式生成、作废在途图像任务并清空排队任务',

    // ---- 配置面板 ----
    configTitle: 'Ritual Configuration',
    sourceLabel: 'The Nightmare (Story)',
    uploadSource: 'Upload .txt',
    sourcePlaceholder: 'Describe the horror story, the ghost, the killer, or the psychological torment here...',
    sourcePlaceholderHistory: 'Describe the horror story, the ghost, the killer, or the psychological torment here...',
    styleLabel: 'Art Style',
    customStyleOption: 'Custom Style...',
    storyModeLabel: 'Primary Genre',
    customStoryLabel: 'Custom Narrative Rules',
    customStoryPlaceholder: 'Describe your custom narrative rules...',
    mainCharacterLabel: 'Main Cast',
    autoDetectOption: '👥 Auto-detect',
    selectCharacterOption: 'Select a character',
    customCharacterOption: 'Custom Character...',
    autoCastBadge: 'AUTO CAST',
    autoCastHint: '* Characters are automatically identified from the story.',
    charNameLabel: 'Name',
    charDescLabel: 'Appearance (hair, outfit, aura)',
    pageLengthLabel: 'Length',
    panelsLabel: 'Panels/Page',
    panelsAuto: 'Auto (Pacing)',
    panelsN: (n: number) => `${n} Panels`,
    ratioLabel: 'Format',
    generating: 'MANIFESTING…',
    generateBtn: 'MANIFEST HORROR',
    estimatedInputTokens: (n: string) => `Est. input ~${n} tokens`,
    readFileFailed: '无法读取文件，请确认文件为 UTF-8 文本。',

    // ---- 资产工作室 ----
    assetStudioTitle: 'BESTIARY (CASTING)',
    assetStudioSubtitle: 'Modify appearance descriptions. Reference images will generate automatically.',
    studioTabAssets: '1. BESTIARY (CASTING)',
    studioTabScript: '2. SCRIPTURES',
    charactersTab: (n: number) => `Entities (${n})`,
    propsTab: (n: number) => `Props (${n})`,
    noReference: 'No Visage',
    generatingLabel: 'SUMMONING...',
    generateRef: 'Generate',
    regenerateRef: 'Regenerate',
    generateProp: 'Generate Prop',
    regenerateProp: 'Regenerate Prop',
    uploadCustomImage: 'Upload',
    noPropsFound: 'No key props identified.',
    noPropsHint: 'The AI found no recurring items to keep consistent.',
    goToScriptEditor: 'ON TO THE SCRIPTURES →',
    charDescPlaceholder: 'Visual Description...',
    propDescPlaceholder: 'Prop appearance...',

    // ---- 剧本编辑器 ----
    storyboardTitle: 'SCRIPTURES',
    storyboardSubtitle: 'Review character designs and script before final production.',
    startProduction: 'CONFIRM & START FILMING →',
    sidebarGlobal: 'GRIMOIRE',
    sidebarOverview: 'Story Analysis',
    sidebarPages: 'PAGES',
    sidebarCover: '00. Cover Art',
    sidebarPage: (n: string) => `${n}. Page`,
    comicTitleLabel: 'Title',
    analysisLabel: 'Story Analysis & Pacing Strategy',
    coverDesignTitle: 'Cover Art',
    coverPromptLabel: 'Cover Art Prompt',
    pageTitle: (n: number) => `Page ${n}`,
    layoutLabel: 'Layout',
    fullPromptLabel: 'Image Prompt',
    fullPromptHint: 'Raw instruction sent to the image model, including character states, environment details and the mandatory Chinese dialogue.',
    charsInScene: 'Cast on This Page',
    propsInScene: 'Props on This Page',
    noCharsInScene: 'No specific characters on this page.',
    noPropsInScene: 'No key props on this page.',
    refinePlaceholder: 'AI Instruction (e.g. Make it darker)',
    refineBtn: 'AI Refine',
    refining: 'Refining...',
    refineFailed: 'AI refine failed, please retry',

    // ---- 漫画页 ----
    comicPagesTitle: 'PAGES FROM THE ABYSS',
    pagesBadge: (ratio: string, n: number) => `${ratio} • ${n} Pages`,
    progressBadge: (done: number, total: number) => `${done} / ${total} Conjured`,
    resumeAll: (n: number) => `Resume Unfinished (${n})`,
    resumeAllTitle: '按并发 2 批量重发全部失败/中止页',
    exportBtn: 'Download Artifacts',
    exportZip: 'ZIP Images',
    exportPdf: 'PDF Document',
    exportLong: 'Long Image',
    exporting: 'Packing…',
    exportedTo: (p: string) => `Exported to ${p}`,
    revealInFolder: 'Reveal in Folder',
    exportFailed: (m: string) => `Export failed: ${m}`,
    coverBadge: 'THE COVER',
    pageBadge: (n: number) => `PAGE ${n}`,
    designingCover: 'CONJURING COVER...',
    drawingPage: (n: number) => `DRAWING PAGE ${n}...`,
    retryPage: 'Re-Summon',
    downloadPage: 'Download Page',
    openReader: 'Enter Reader Mode',
    editPrompt: 'View/Edit Prompt',
    closePrompt: 'Close Prompt',
    includeChars: 'Scene Cast (Reference Injection)',
    includeProps: 'Props on This Page',
    fullImagePrompt: 'Image Prompt (Draft)',
    aiRefinePrompt: 'Dark Whisper (AI Modify)',
    refineInputPlaceholder: 'e.g. "Make it rain harder", "Add a cat"',
    cancelBtn: 'Cancel',
    redrawBtn: 'Re-Summon',
    viewPromptLink: 'View Prompt & Casting',
    pageLayoutLabel: 'Layout',
    writtenBy: 'Generated by HorrorManga AI',
    untitled: 'UNTITLED',
    pageSaveFailed: (m: string) => `Save failed: ${m}`,

    // ---- 生成进度 ----
    stageQueued: 'Queued…',
    stageDrawing: 'Drawing…',
    stageDrawingN: (r: number, t: number) => `Drawing ${r}/${t}…`,
    stageFinalizing: 'Finalizing…',
    stageFallback: 'Retrying…',

    // ---- 通知 ----
    notifyBatchDone: (title: string, done: number) => `《${title}》: all ${done} pages conjured`,
    notifyBatchFailed: (title: string, done: number, failed: number) =>
      `《${title}》: ${done} done / ${failed} failed — redraw individually on the card`,
    notifyScriptDone: (title: string) => `《${title}》script ready — confirm the casting`,

    // ---- 错误文案 ----
    pageDrawFailed: (m: string) =>
      `Drawing failed: ${m}. Retry on this page; if it keeps failing, switch the image model in the config panel (current model may not support multi-reference input).`,
    pageAborted: 'Ritual Interrupted by User.',

    // ---- 终端日志面板 ----
    terminalTitle: (model: string) => `AI_AGENT_TERMINAL -- ${model}`,
    defaultModelLabel: 'MULBY 默认模型',
    terminalReady: 'System Ready.',
    terminalWaiting: 'Waiting for script generation task...',
    terminalStreaming: '● PROCESSING STREAM',
    terminalIdle: '○ IDLE',

    // ---- Token 监控 ----
    taskCost: 'EST. COST',
    totalTokens: 'Tokens:',
    imagesGenerated: 'Images:',
    costBreakdown: 'By Model',
    recentActivity: 'Recent Calls',
    noActivity: 'No calls yet.',
    estimatedBadge: 'EST',
    unpricedCalls: (n: number) => `+ ${n} unpriced calls`,
    unpricedRow: 'unpriced',

    // ---- Phase 2：副故事模式 / 结局 / 水印 / 色彩 ----
    secondaryStoryModeLabel: 'Subgenre (Blend)',
    secondaryStoryModeNone: 'None (Pure)',
    endingLabel: 'Ending Style',
    colorModeLabel: 'Color Mode',
    watermarkTitle: '© Cursed Seal (Watermark)',
    watermarkEnable: 'Enable Seal',
    watermarkTypeLabel: 'Style',
    watermarkTextLabel: 'Text Content',
    watermarkTextPlaceholder: 'e.g. @YourName',
    watermarkImageLabel: 'Seal Image',
    watermarkUploadImage: 'Upload Image',
    watermarkChangeImage: 'Change Image',
    watermarkOpacityLabel: 'Opacity',
    watermarkPageTitle: (n: number) => `Seal Settings (Page ${n})`,
    watermarkModeLabel: 'Mode',
    watermarkModeGlobal: 'GLOBAL SYNC',
    watermarkModeCustom: 'CUSTOM',
  },

  // —— 视觉层（红黑配色；Creepster 标题字体 + Space Grotesk 正文，字体文件在 index.css 引入） ——
  ui: {
    fontFamily: "'Space Grotesk', sans-serif",
    headingFontFamily: "'Creepster', cursive",
    accent: '#dc2626',          // red-600（标题强调/选中色）
    accentSecondary: '#991b1b', // red-800（logo 渐变终点）
    ctaFrom: '#7f1d1d',         // red-900（原 MANIFEST HORROR / 下载按钮底色）
    ctaTo: '#7f1d1d',
    ctaHoverFrom: '#991b1b',    // red-800（原 hover 色）
    ctaHoverTo: '#991b1b',
    colorScheme: 'dark',
    background: '#020617',
    text: '#f1f5f9',
  },

  features: {
    watermark: true,
    endings: true,
    secondaryStoryMode: true,
    props: false,
  },
};

export default horrorTheme;
