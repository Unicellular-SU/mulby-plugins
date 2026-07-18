
import { HorrorStyle, AspectRatio, StoryMode, WatermarkType, EndingType, ColorMode } from './types';

export const STYLE_OPTIONS = [
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
];

export const ASPECT_RATIOS = [
  { label: '2:3 (Manga Page)', value: AspectRatio.MANGA_PAGE },
  { label: '3:4 (Portrait)', value: AspectRatio.PORTRAIT },
  { label: '1:1 (Square)', value: AspectRatio.SQUARE },
  { label: '4:3 (Landscape)', value: AspectRatio.LANDSCAPE },
  { label: '16:9 (Cinematic)', value: AspectRatio.WIDE },
];

export const PAGE_LENGTH_OPTIONS = [
  { label: 'Short (3-5 Pages)', value: 'Short' },
  { label: 'Medium (6-10 Pages)', value: 'Medium' },
  { label: 'Long (11-15 Pages)', value: 'Long' },
];

export const STORY_MODES = [
  { label: '心理恐怖 (Psychological)', value: StoryMode.PSYCHOLOGICAL },
  { label: '血腥砍杀 (Slasher/Gore)', value: StoryMode.SLASHER },
  { label: '灵异鬼怪 (Ghost Story)', value: StoryMode.GHOST },
  { label: '身体变异 (Body Horror)', value: StoryMode.BODY_HORROR },
  { label: '未知恐惧 (Cosmic Horror)', value: StoryMode.COSMIC },
  { label: '科技惊悚 (Tech/Cyber)', value: StoryMode.TECH_HORROR },
  { label: '民俗恐怖 (Folk/Rural)', value: StoryMode.FOLK_HORROR },
  { label: '极限生存 (Survival)', value: StoryMode.SURVIVAL },
  { label: '巨型怪物 (Monster/Kaiju)', value: StoryMode.MONSTER },
];

export const ENDING_TYPE_OPTIONS = [
  { label: '悲剧结局 (Total Tragedy)', value: EndingType.TRAGEDY },
  { label: '惊天反转 (Shock Twist)', value: EndingType.TWIST },
  { label: '开放式 (Ambiguous/Open)', value: EndingType.OPEN },
  { label: '无限循环 (Infinite Loop)', value: EndingType.LOOP },
  { label: '逃出生天 (Relief/Escape)', value: EndingType.RELIEF },
  { label: '惨胜 (Pyrrhic Victory)', value: EndingType.PYRRHIC },
];

export const COLOR_MODE_OPTIONS = [
  { label: 'Black & White (Traditional Manga)', value: ColorMode.BLACK_AND_WHITE },
  { label: 'Full Color (Webtoon Style)', value: ColorMode.FULL_COLOR },
];

export const WATERMARK_TYPE_OPTIONS = [
  { label: 'Text: Tiled (Diagonal)', value: WatermarkType.TEXT_TILED },
  { label: 'Text: Bottom Corner', value: WatermarkType.TEXT_CORNER },
  { label: 'Image: Center (Large)', value: WatermarkType.IMAGE_CENTER },
  { label: 'Image: Bottom Corner', value: WatermarkType.IMAGE_CORNER },
];

export const STORY_MODE_PROMPTS: Record<StoryMode, string> = {
  [StoryMode.PSYCHOLOGICAL]: `
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

  [StoryMode.SLASHER]: `
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

  [StoryMode.GHOST]: `
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

  [StoryMode.BODY_HORROR]: `
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

  [StoryMode.COSMIC]: `
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

  [StoryMode.TECH_HORROR]: `
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

  [StoryMode.FOLK_HORROR]: `
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

  [StoryMode.SURVIVAL]: `
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

  [StoryMode.MONSTER]: `
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
};
