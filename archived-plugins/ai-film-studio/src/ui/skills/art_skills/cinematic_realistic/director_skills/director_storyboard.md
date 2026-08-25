---
name: director_storyboard
description: 导演分镜提示词技法 · 写实电影感
metaData: director_skills
---

# 分镜提示词 · 写实电影感 · 风格专属技法

## 适用范围
本 Skill 用于「写实电影感」风格的分镜关键帧/视频提示词生成。

## 情绪 → 面容/眼神词映射
| 情绪输入 | 面容词 | 眼神词 | 微表情 |
|---|---|---|---|
| 温柔/深情 | 神情柔和 | 目光温暖专注 | 嘴角微扬 |
| 坚定/勇敢 | 神情沉稳 | 目光清亮坚定 | 下颌微收 |
| 愤怒/对峙 | 眉头紧锁 | 目光锐利逼视 | 咬肌收紧 |
| 羞涩/迟疑 | 视线躲闪 | 目光低垂 | 抿唇 |
| 悲伤/隐忍 | 眼眶泛红 | 目光失焦 | 嘴角下压 |
| 惊讶/错愕 | 瞳孔微张 | 目光骤聚 | 微张口 |
| 疲惫/失落 | 眼神黯淡 | 目光涣散 | 表情松弛 |

## 景别 → 镜头语言
| 景别 | 焦段/取景 | 适用 |
|---|---|---|
| 远景/大全 | 16-24mm，环境主导 | 交代时空、空镜、孤独感 |
| 全景 | 28-35mm，人物全身 | 动作、场面调度 |
| 中景 | 50mm，腰部以上 | 对话、关系 |
| 近景 | 85mm，肩部以上 | 情绪、反应 |
| 特写 | 100mm，面部/局部 | 强情绪、关键道具 |

## 运镜 → 英文短语
| 中文 | 英文短语 |
|---|---|
| 固定 | locked-off static shot |
| 推 | slow dolly-in |
| 拉 | slow dolly-out |
| 摇 | smooth pan |
| 移/跟 | tracking shot following the subject |
| 升降 | crane move |
| 手持 | subtle handheld |

## 光影氛围（按时间/情绪选一致基调）
- 始终写明**光源方向 + 色温**，同一连贯段落保持一致（避免逐镜跳光）。
- 清晨：低角度暖侧光、薄雾、长投影。
- 正午：高角度硬光、短投影、高对比。
- 黄昏/黄金时刻：暖金逆光、轮廓光、通透。
- 夜：冷蓝环境光 + 暖色实用光源点缀（路灯/霓虹/烛光）。
- 雨/阴：漫射柔光、低对比、湿润反光。

## 提示词组装顺序（关键帧）
`[景别短语], [主体+动作+情绪(面容/眼神)], [所在场景与环境], [光源方向+色温+氛围], [本画风锚定词], cinematic film still, shallow depth of field, highly detailed`

## 连贯性硬规则
- 承接镜头：写「continue directly from the previous shot, same location, same lighting and color, keep characters consistent in appearance and screen position」。
- 严守轴线/屏幕方向：上一镜从画面左侧离场，下一镜从右侧进入。
