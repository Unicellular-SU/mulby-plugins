
import { CharacterProfile, ComicStyle, AspectRatio, StoryMode } from './types';

export const PRESET_CHARACTERS: CharacterProfile[] = [
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
];

export const STYLE_OPTIONS = [
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
];

export const ASPECT_RATIOS = [
  { label: '2:3（漫画页）', value: AspectRatio.MANGA_PAGE },
  { label: '3:4（竖版）', value: AspectRatio.PORTRAIT },
  { label: '1:1（方形）', value: AspectRatio.SQUARE },
  { label: '4:3（横版）', value: AspectRatio.LANDSCAPE },
  { label: '16:9（宽银幕）', value: AspectRatio.WIDE },
];

export const PAGE_LENGTH_OPTIONS = [
  { label: '短篇（3-5 页）', value: 'Short' },
  { label: '中篇（6-10 页）', value: 'Medium' },
  { label: '长篇（11-15 页）', value: 'Long' },
];

export const STORY_MODES = [
  { label: '💥 剧情演绎 (Action/Drama)', value: StoryMode.CONFLICT },
  { label: '🧠 大众科普 (Science Communication)', value: StoryMode.SCI_COMM },
  { label: '🏛️ 严肃历史 (Serious History / Documentary)', value: StoryMode.HISTORY_SERIOUS }, // New
  { label: '🎭 历史乱炖 (History Parody / Cosplay)', value: StoryMode.HISTORY_PARODY },     // New
  { label: '🏫 师生教学 (Educational)', value: StoryMode.EDUCATIONAL },
  { label: '⚔️ 异世界转生 (Isekai)', value: StoryMode.ISEKAI },
  { label: '🕵️ 悬疑推理 (Mystery)', value: StoryMode.MYSTERY },
  { label: '💼 职场风云 (Office Drama)', value: StoryMode.OFFICE_DRAMA },
  { label: '🤣 爆笑喜剧 (Comedy)', value: StoryMode.COMEDY },
  { label: '👻 惊悚恐怖 (Horror)', value: StoryMode.HORROR },
  { label: '✨ 自定义规则 (Custom)', value: StoryMode.CUSTOM },
];

export const STORY_MODE_PROMPTS: Record<StoryMode, string> = {
  [StoryMode.HISTORY_SERIOUS]: `
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
  `,

  [StoryMode.HISTORY_PARODY]: `
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
  `,

  [StoryMode.CONFLICT]: `
    1. **Narrative Lens (Dynamic)**:
        - Analyze the input source text first.
        - **IF** the text is a "How-to Guide": The plot is a Training Arc. The Hero must master a new technique (the code) to defeat a dummy target.
        - **IF** the text is a "Bug Fix/Analysis": The plot is a Battle. The Bug is a monster/villain destroying the city. The Hero uses the fix as the finishing move.
        - **IF** the text is "Architecture/System Design": The plot is a Siege/Defense. The Hero is building a fortress (the system) to withstand an invasion (high traffic/hackers).
    
    2. **Characters (STRICT CANONICAL)**:
        - **Hero**: \${character.name}.
        - **Opponent**: A canonical villain OR a canonical rival (e.g. Vegeta/Bakugo) representing the problem.
    
    3. **Tone**: High stakes, Shonen Jump style, dramatic speeches about technical details.
  `,

  [StoryMode.SCI_COMM]: `
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
        - **Increase Dialogue & Narration**: Each panel/page must have rich dialogue and narration to guide the reader.
        - **Explanatory**: Ensure the "Why" and "How" are explained in the text bubbles, not just implied.
  `,

  [StoryMode.EDUCATIONAL]: `
    1. **Narrative Lens (Mentorship)**:
        - Analyze the input source text.
        - **IF** text is complex theory: The setting is a Classroom or Dojo. The Mentor uses a physical analogy to explain it.
        - **IF** text is a list of mistakes: The Student is trying to do it and failing comically. The Mentor steps in to correct form.
        - **IF** text is best practices: A "Field Trip" where they observe a "Perfect System" vs a "Bad System".
    
    2. **Characters (STRICT CANONICAL)**:
        - **Mentor**: \${character.name}.
        - **Student**: A canonical sidekick/younger character (e.g., Nobita, Chopper, Genos).
    
    3. **Tone**: Patient, enlightened, emphasizing "The Why" before "The How".
  `,

  [StoryMode.MYSTERY]: `
    1. **Narrative Lens (The Investigation)**:
        - Analyze the input source text.
        - **IF** text is debugging/tracing: A "Crime Scene". The logs are blood trails. The Hero uses a magnifying glass (debugger).
        - **IF** text is security/auth: A "Spy Thriller". An imposter is trying to sneak in. The Hero must verify identities (tokens).
        - **IF** text is data analysis: A "Puzzle Room". The Hero must arrange the clues (data) to find the truth.
    
    2. **Characters (STRICT CANONICAL)**:
        - **Detective**: \${character.name}.
        - **Suspect/Witness**: Canonical characters behaving suspiciously.
    
    3. **Tone**: Noir, shadowy, internal monologues, "There is only one truth!".
  `,

  [StoryMode.COMEDY]: `
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
  `,

  [StoryMode.ISEKAI]: `
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
  `,

  [StoryMode.OFFICE_DRAMA]: `
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
  `,

  [StoryMode.HORROR]: `
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
  `,

  [StoryMode.CUSTOM]: `
    1. **Narrative Approach: "User Defined"**:
        - **Instruction**: Follow the USER PROVIDED RULES below strictly.
        - **User Rules**: \${customPrompt}
    
    2. **Characters & Casting**:
        - **Main Character**: \${character.name} (\${character.description}).
        - **Casting Rule**: Adapt casting based on the user's custom scenario, but prefer existing canonical characters if possible.
  `
};
