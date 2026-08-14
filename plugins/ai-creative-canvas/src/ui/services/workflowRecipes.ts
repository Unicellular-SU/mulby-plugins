import type { AgentCommandName, WorkflowRecipeId } from '../types'

export interface WorkflowRecipeStepSpec {
  command: AgentCommandName
  title: string
  description: string
  requiresApproval: boolean
}

export interface WorkflowRecipeDefinition {
  id: WorkflowRecipeId
  label: string
  shortLabel: string
  description: string
  sourceLabel: string
  sourcePlaceholder: string
  defaultGoal: string
  defaultDuration: number
  defaultEnding: string
  endingPlaceholder: string
  schemaName: string
  sourceHeading: string
  systemPrompt: string
  steps: readonly WorkflowRecipeStepSpec[]
}

const COMMON_STEPS = {
  materialize_continuity: {
    command: 'materialize_continuity',
    title: '准备连续性设定卡',
    description: '复用已有素材，并为缺少视觉基准的角色、场景和道具幂等创建设定图卡片。',
    requiresApproval: false
  },
  generate_continuity: {
    command: 'generate_continuity',
    title: '生成连续性设定图',
    description: '先生成角色、场景和关键道具的统一视觉基准，不直接生成镜头画面。',
    requiresApproval: false
  },
  lock_continuity: {
    command: 'lock_continuity',
    title: '确认并锁定视觉设定',
    description: '检查人物外观、服装、产品结构、Logo、道具和场景；确认后锁定当前产物，并注入相关镜头。',
    requiresApproval: true
  },
  materialize_images: {
    command: 'materialize_images',
    title: '落地静帧卡片',
    description: '按镜头表幂等创建或同步图片卡片。',
    requiresApproval: false
  },
  generate_images: {
    command: 'generate_images',
    title: '生成镜头静帧',
    description: '仅生成尚未完成或输入已失效的静帧卡片。',
    requiresApproval: false
  },
  create_videos: {
    command: 'create_videos',
    title: '确认静帧并创建视频卡',
    description: '检查静帧后，以每镜选定图片作为首帧创建视频卡。',
    requiresApproval: true
  },
  generate_videos: {
    command: 'generate_videos',
    title: '生成视频片段',
    description: '按 Provider 能力与镜头时长生成视频片段。',
    requiresApproval: false
  },
  prepare_timeline: {
    command: 'prepare_timeline',
    title: '送入时间线',
    description: '选择所有已生成片段并打开时间线，最终合成仍由用户确认。',
    requiresApproval: false
  }
} as const satisfies Record<string, WorkflowRecipeStepSpec>

const RECIPES: Record<WorkflowRecipeId, WorkflowRecipeDefinition> = {
  'script-to-short-film': {
    id: 'script-to-short-film',
    label: '剧本转短片',
    shortLabel: '剧情短片',
    description: '把故事或剧本整理为连续分镜，依次确认创作规格、视觉设定和静帧后生成视频并送入时间线。',
    sourceLabel: '剧本 / 故事卡片',
    sourcePlaceholder: '选择剧本、故事或创意说明',
    defaultGoal: '把剧本整理成可生成的分镜短片',
    defaultDuration: 30,
    defaultEnding: '自然收束',
    endingPlaceholder: '留白 / 反转 / 自然收束',
    schemaName: 'short_film_creative_brief',
    sourceHeading: '原始剧本',
    systemPrompt: '你是资深短片导演与分镜师。只负责把用户剧本整理为结构化创作规格和镜头草案；不要输出工具调用、命令、代码或执行步骤。totalDuration 是最终成片总时长，不是每个镜头的时长；所有 shots.duration 之和必须等于 totalDuration。静帧提示词描述单一可见时刻，视频提示词必须描述动作节奏和明确运镜。前后角色、服装、场景和道具保持连续。凡是在两个以上镜头出现的角色、关键道具或核心场景，都必须写入 anchorSuggestions；description 必须给出足以锁定外观的具体视觉设定（五官与发型、体型、服装配色，或结构、材质、颜色、Logo、空间布局等），不能只写“保持一致”。每个镜头必须把实际出现的这些名称原样写入 anchorNames。anchorNames 只能填写需要图片身份基准的可见角色、产品、道具、场景或视觉风格名称；音乐、节拍、音效、旁白、配音、对白，以及“无人出镜”“无人物”等否定描述严禁写入 anchorNames 或角色设定。优先复用工程已有语义锚点的准确名称，不得臆造已有锚点的媒体内容。画布风格应融入 imagePrompt 与 videoPrompt。',
    steps: [
      { command: 'save_storyboard', title: '确认创作规格', description: '检查受众、画幅、总时长、结尾和角色 / 场景设定后保存故事板。', requiresApproval: true },
      COMMON_STEPS.materialize_continuity,
      COMMON_STEPS.generate_continuity,
      COMMON_STEPS.lock_continuity,
      COMMON_STEPS.materialize_images,
      COMMON_STEPS.generate_images,
      COMMON_STEPS.create_videos,
      COMMON_STEPS.generate_videos,
      COMMON_STEPS.prepare_timeline
    ]
  },
  'product-ad-film': {
    id: 'product-ad-film',
    label: '产品广告短片',
    shortLabel: '产品广告',
    description: '从产品 Brief 与相连素材提炼卖点和 CTA，生成可控的广告分镜、产品静帧与视频片段。',
    sourceLabel: '产品 Brief 卡片',
    sourcePlaceholder: '选择产品说明、卖点或广告需求',
    defaultGoal: '把产品卖点整理成可生成的品牌广告短片',
    defaultDuration: 15,
    defaultEnding: '产品定帧、品牌名与行动号召',
    endingPlaceholder: 'Packshot / 品牌名 / CTA',
    schemaName: 'product_ad_creative_brief',
    sourceHeading: '产品 Brief',
    systemPrompt: '你是资深品牌广告创意总监与商业分镜导演。只负责把产品 Brief 和工程素材整理成结构化广告规格与镜头草案；不要输出工具调用、命令、代码或执行步骤。totalDuration 是最终广告成片总时长，不是每个片段时长；所有 shots.duration 之和必须等于 totalDuration。先提炼产品名称、传播目标、核心主张、可验证卖点、强制露出元素和行动号召；product.brandText 必须逐字抄录 Brief 中明确给出的品牌或 Logo 文字，没有可验证文字时留空。不得杜撰原文没有提供的功能、数据、奖项、功效或合规承诺。镜头应形成“抓住注意—问题或场景—产品揭示—核心利益演示—细节或使用证据—Packshot 与 CTA”的可理解节奏，并按实际总时长取舍镜头数量。静帧提示词只描述一个可见时刻；视频提示词描述主体动作、节奏和明确运镜。只建立一个产品主设定 anchorSuggestions；包装、Logo、结构细节、使用动作分别作为派生设定，不得再创建第二个同义产品本体。description 必须具体写明不可变化的几何结构、材质、颜色、包装、Logo、已有文字或人物外观，不能只写“保持一致”。每个相关镜头都必须把这些名称原样写入 anchorNames。anchorNames 只能填写需要图片身份基准的可见角色、产品、道具、场景或视觉风格名称；音乐、节拍、音效、旁白、配音、对白，以及“无人出镜”“无人物”等否定描述严禁写入 anchorNames 或角色设定。工程中已有对应锚点时必须优先使用其准确名称；不得改变 Logo、包装结构、产品几何和已有文字。相连但未建立锚点的媒体也应按其卡片标题和描述作为视觉参考。画布风格应融入 imagePrompt 与 videoPrompt，不得把含有其他人物或产品的风格拼图当作身份参考；每个相关镜头都要明确保留强制露出元素。',
    steps: [
      { command: 'save_storyboard', title: '确认广告策略与镜头', description: '检查核心主张、卖点依据、品牌强制元素、CTA、画幅与时长后保存广告故事板。', requiresApproval: true },
      { ...COMMON_STEPS.materialize_continuity, description: '优先复用相连的产品、包装和 Logo 素材，并为缺少基准的主体创建设定卡。' },
      { ...COMMON_STEPS.generate_continuity, title: '生成产品与角色设定图' },
      { ...COMMON_STEPS.lock_continuity, description: '检查产品几何、包装、Logo、人物和场景；确认后锁定当前视觉基准并注入广告镜头。' },
      { ...COMMON_STEPS.materialize_images, description: '按广告镜头表幂等创建或同步图片卡，并继承相连产品素材与语义锚点。' },
      { ...COMMON_STEPS.generate_images, title: '生成广告关键帧' },
      { ...COMMON_STEPS.create_videos, description: '检查产品、包装、Logo 和文案是否正确；确认后才创建视频卡。' },
      { ...COMMON_STEPS.generate_videos, title: '生成广告片段' },
      COMMON_STEPS.prepare_timeline
    ]
  }
}

export const WORKFLOW_RECIPES = Object.values(RECIPES)

export function isWorkflowRecipeId(value: unknown): value is WorkflowRecipeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RECIPES, value)
}

export function getWorkflowRecipe(id: WorkflowRecipeId): WorkflowRecipeDefinition {
  return RECIPES[id]
}
