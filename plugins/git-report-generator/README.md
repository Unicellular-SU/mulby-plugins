# Git 日报生成器 (git-report-generator)

> 输入 Git 项目路径，自动抓取提交日志，用 AI 生成总结日报/周报，支持自定义模板与 GitHub 风格排版。

## 功能特性

- 🔍 **自动识别 Git 仓库** - 输入路径即可自动检测仓库信息（分支、远程地址）
- 📊 **日报/周报/自定义报告** - 支持按天、按周或自定义时间范围生成报告
- 🤖 **AI 智能总结** - 调用 Mulby AI 对提交记录进行分类、总结和深度分析
- 📝 **多种内置模板** - 日报模板、周报模板、GitHub Release Notes 风格
- ✏️ **自定义模板** - 支持创建、编辑、删除个人模板，使用变量占位符
- 📋 **一键复制/保存** - 生成的 Markdown 报告可复制到剪贴板或保存为 .md 文件
- 🌗 **亮暗主题** - 自动跟随 Mulby 主题切换

## 触发方式

| 触发方式 | 说明 |
|---------|------|
| 关键词 `git日报` | 在 Mulby 搜索框中输入触发 |
| 关键词 `git报告` | 在 Mulby 搜索框中输入触发 |
| 拖入文件夹 | 将 Git 项目文件夹拖入 Mulby 输入框 |

## 使用方法

1. **打开插件** - 通过关键词或拖入文件夹触发
2. **输入/确认项目路径** - 支持手动输入、浏览选择或拖入
3. **选择报告类型** - 日报/周报/自定义
4. **设置时间范围** - 自动填充或手动调整
5. **选择模板** - 从内置或自定义模板中选择
6. **（可选）添加额外提示** - 为 AI 添加特殊要求
7. **点击「生成报告」** - AI 将分析提交记录并生成结构化报告
8. **复制或保存** - 将报告复制到剪贴板或保存为文件

## 模板变量

自定义模板支持以下占位符：

| 变量 | 说明 |
|------|------|
| `{{repo_name}}` | 仓库名称 |
| `{{branch}}` | 当前分支 |
| `{{remote_url}}` | 远程仓库地址 |
| `{{date_range}}` | 报告时间范围 |
| `{{commit_count}}` | 提交总数 |
| `{{contributor_count}}` | 贡献者人数 |
| `{{files_changed}}` | 变更文件数 |
| `{{insertions}}` | 新增行数 |
| `{{deletions}}` | 删除行数 |
| `{{contributors}}` | 贡献者列表 |
| `{{commits}}` | 提交记录列表 |
| `{{commits_github_style}}` | GitHub 风格提交列表 |
| `{{summary}}` | AI 生成的总结 |
| `{{ai_insights}}` | AI 深度洞察 |
| `{{diff_details}}` | 文件差异详情 |
| `{{generated_at}}` | 生成时间戳 |

## 开发

### 安装依赖

```bash
pnpm install
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

```
git-report-generator/
├── manifest.json          # 插件配置
├── package.json
├── src/
│   ├── main.ts            # 后端：Git 操作 + AI 调用 + RPC
│   ├── types/
│   │   └── mulby.d.ts     # Mulby API 类型定义
│   ├── ui/
│   │   ├── App.tsx        # 主界面（完整 UI）
│   │   ├── main.tsx       # React 入口
│   │   ├── index.html     # HTML 模板
│   │   ├── styles.css     # 全局样式（含 Markdown 渲染）
│   │   └── hooks/
│   │       └── useMulby.ts
├── dist/                  # 后端构建输出
├── ui/                    # 前端构建输出
└── icon.png               # 插件图标
```

## 许可

MIT License
