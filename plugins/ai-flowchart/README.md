# AI 图表

AI 智能生成流程图、泳道图、ER 图，支持对话式编辑、自定义节点、自动布局和多格式导出。

## 功能特性

- 🤖 **AI 对话生成** — 用自然语言描述即可生成完整图表
- 📝 **对话式编辑** — 通过对话持续修改、优化图表
- 📋 **选中文字生成** — 直接从选中的文字内容一键生成流程图
- 🔄 **三种图表类型** — 流程图、泳道图、ER 图自由切换
- 🗂️ **项目管理** — 保存/打开/删除项目，支持未保存提示
- ↩️ **撤销/重做** — 完整操作历史记录
- 📐 **自动布局** — 基于 Dagre 的智能节点排布
- 📏 **对齐辅助线** — 拖拽时自动对齐
- 🔗 **边重连接** — 拖拽箭头快速更换连接点
- 📤 **多格式导出** — PNG / SVG / JSON，导出完整图表
- 📥 **JSON 导入** — 从 JSON 文件导入图表
- 📋 **复制到剪贴板** — 一键复制图表为图片
- ⌨️ **快捷键** — Cmd/Ctrl+S 保存，Cmd/Ctrl+Z 撤销
- 🎨 **深色/浅色主题** — 自动适配系统主题

## 图表类型

### 📊 流程图
支持 14 种专业流程图节点：

| 类型 | 形状 | 用途 |
|------|------|------|
| `start` | 椭圆 | 流程起点 |
| `end` | 椭圆 | 流程终点 |
| `process` | 矩形 | 处理/操作步骤 |
| `decision` | 菱形 | 条件判断/分支 |
| `text` | 无边框 | 注释说明 |
| `io` | 平行四边形 | 数据输入/输出 |
| `database` | 圆柱体 | 数据库读写 |
| `document` | 波浪底边 | 文档/报告 |
| `subroutine` | 双竖线矩形 | 子程序/API 调用 |
| `delay` | D 型 | 等待/延迟 |
| `preparation` | 六边形 | 初始化/准备 |
| `manual` | 倒梯形 | 人工操作 |
| `connector` | 小圆圈 | 跨区连接标记 |
| `group` | 虚线容器 | 分组/子流程 |

### 🏊 泳道图
跨部门/角色协作流程可视化：
- **泳道容器**：每个角色/部门用一个泳道表示
- **标准节点**：泳道内使用流程图节点
- **跨泳道连线**：自动处理跨泳道的流程连接
- **自动布局**：泳道内水平布局，泳道间垂直排列

### 🗃️ ER 图
数据库实体关系图设计：
- **实体节点**：表格式布局，包含字段名、类型
- **主键/外键标识**：🔑 主键 / 🔗 外键
- **关系连线**：1:1、1:N、N:M 关系标注
- **水平布局**：默认 LR 方向排列

## 触发方式

- `流程图` / `flowchart` / `fc` — 打开 AI 图表
- `泳道图` / `swimlane` — 打开 AI 图表
- `ER图` / `er` — 打开 AI 图表
- `流程图项目` — 打开已保存的项目
- 选中文字（≥10 字符）→ `生成流程图` — 从选中文字生成

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 打包

```bash
npm run pack
```

## 项目结构

```
ai-flowchart/
├── manifest.json                    # 插件配置
├── package.json
├── src/
│   ├── main.ts                      # 后端入口（项目 CRUD、文件导出）
│   ├── ui/
│   │   ├── App.tsx                  # 主应用（三栏布局）
│   │   ├── main.tsx                 # UI 入口
│   │   ├── index.html               # HTML 模板
│   │   ├── styles.css               # 全局样式（深色/浅色主题）
│   │   ├── store/
│   │   │   └── flowStore.ts         # Zustand 状态管理
│   │   ├── components/
│   │   │   ├── Toolbar.tsx          # 工具栏（图表类型/保存/导出/模型选择）
│   │   │   ├── ChatPanel.tsx        # AI 对话面板
│   │   │   ├── FlowCanvas.tsx       # React Flow 画布
│   │   │   ├── ProjectList.tsx      # 项目列表侧边栏
│   │   │   └── nodes/
│   │   │       ├── CustomNodes.tsx  # 14 种流程图节点
│   │   │       ├── GroupNode.tsx    # 分组容器节点
│   │   │       ├── LaneNode.tsx    # 泳道容器节点
│   │   │       └── EntityNode.tsx  # ER 图实体节点
│   │   ├── hooks/
│   │   │   ├── useMulby.ts         # Mulby API Hook
│   │   │   ├── useAutoLayout.ts    # 自动布局 Hook
│   │   │   └── useHelperLines.ts   # 对齐辅助线 Hook
│   │   ├── services/
│   │   │   └── aiService.ts        # AI 服务（三套 Prompt + 流式解析）
│   │   └── utils/
│   │       ├── layoutUtils.ts      # Dagre 布局算法
│   │       ├── swimlaneLayout.ts   # 泳道图布局算法
│   │       └── edgeUtils.ts        # 边处理/跨组重映射
│   └── types/
│       └── mulby.d.ts              # 类型定义
├── dist/                            # 后端构建输出
├── ui/                              # UI 构建输出
└── icon.png                         # 插件图标
```

## 许可证

MIT License
