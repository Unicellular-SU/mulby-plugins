# word-counter

Mulby 字数统计插件，用来快速统计文本的字符数、汉字数、英文词数、句子、段落、行数和预计阅读时间。

## 功能特性

- 支持手动输入文本并实时刷新统计结果
- 支持通过 Mulby 划词动作把选中文本直接带入插件
- 支持从系统剪贴板读取文本
- 提供内容构成分析和一键复制统计摘要
- 自动保存上一次草稿，重新打开可继续编辑

## 触发方式

- `字数统计`
- `字符统计`
- `word count`
- 划词后选择 `统计字数`

## 开发

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm run dev
```

### 构建

```bash
pnpm run build
```

### 打包

```bash
pnpm run pack
```

## 项目结构

```text
word-counter/
├── manifest.json              # 插件配置与触发器
├── package.json
├── src/
│   ├── main.ts                # 后端入口
│   ├── text-stats.ts          # 统计逻辑
│   ├── ui/
│   │   ├── App.tsx            # 主界面
│   │   ├── main.tsx           # UI 入口
│   │   ├── index.html         # HTML 模板
│   │   ├── styles.css         # 界面样式
│   │   ├── hooks/
│   │   │   └── useMulby.ts    # Mulby API Hook
│   └── types/
│       └── mulby.d.ts         # Mulby 类型定义
├── dist/                      # 后端构建输出
├── ui/                        # UI 构建输出
├── word-counter-1.0.0.inplugin
└── icon.png
```

## 许可证

MIT License
