# JSON 编辑器

强大的 JSON 编辑工具，支持格式化、压缩、校验、转换、树形编辑和过滤。集成 CodeMirror 6 代码编辑器，提供专业的编辑体验。

## 功能特性

### ✨ 核心功能

- **专业代码编辑器** - 集成 CodeMirror 6，提供语法高亮、代码折叠、自动补全等功能
- **JSON 格式化** - 美化 JSON 数据，使其更易读
- **JSON 压缩** - 去除空格和换行，压缩 JSON 体积
- **语法校验** - 实时检测 JSON 语法错误，并标记错误位置
- **多格式支持**
  - JSON - 标准 JSON 格式
  - YAML - 自动转换 YAML 为 JSON
  - XML - 自动转换 XML 为 JSON

### 🔄 格式转换

- **JSON → YAML** - 将 JSON 转换为 YAML 格式
- **JSON → XML** - 将 JSON 转换为 XML 格式
- **YAML → JSON** - 自动识别并转换 YAML 输入
- **XML → JSON** - 自动识别并转换 XML 输入

### 🌲 树形视图

- 可折叠/展开的树形结构
- 显示数组长度和对象键数量
- 语法高亮（键名、字符串、数字、布尔值、null）
- 支持深层嵌套数据

### 🔍 高级功能

- **JavaScript 过滤** - 使用 JavaScript 表达式快速过滤和处理 JSON 数据
  - 示例: `data.filter(x => x.age > 18)` - 过滤数组
  - 示例: `data.users` - 提取特定字段
  - 示例: `data.map(x => x.name)` - 映射数组

### 🎨 界面特性

- **CodeMirror 6 编辑器** - 专业的代码编辑体验
- **亮色/暗色主题** - 自动跟随系统主题
- **实时预览** - 输入即时解析和显示
- **一键复制** - 快速复制处理后的结果
- **响应式布局** - 自适应窗口大小

## 触发方式

### 1. 关键词触发
在 Mulby 搜索框输入 `json` 即可打开插件

### 2. JSON 数据自动识别
直接在搜索框粘贴 JSON 数据（以 `{` 或 `[` 开头），自动识别并打开插件

示例：
```json
{"name": "张三", "age": 25}
```

```json
[1, 2, 3, 4, 5]
```

### 3. YAML 数据自动识别
直接粘贴 YAML 数据，自动转换为 JSON

示例：
```yaml
name: 张三
age: 25
city: 北京
```

### 4. XML 数据自动识别
直接粘贴 XML 数据，自动转换为 JSON

示例：
```xml
<user>
  <name>张三</name>
  <age>25</age>
</user>
```

## 使用示例

### 格式化 JSON
1. 在编辑器中输入或粘贴压缩的 JSON
2. 点击底部的 "✨ 格式化" 按钮
3. JSON 会自动美化

### 压缩 JSON
1. 在编辑器中输入或粘贴格式化的 JSON
2. 点击底部的 "🗜️ 压缩" 按钮
3. JSON 会被压缩为单行

### 使用过滤功能
假设有以下 JSON 数据：
```json
{
  "users": [
    {"name": "张三", "age": 25, "city": "北京"},
    {"name": "李四", "age": 30, "city": "上海"},
    {"name": "王五", "age": 20, "city": "广州"}
  ]
}
```

在底部过滤框输入：
- `data.users` - 提取 users 数组
- `data.users.filter(x => x.age > 25)` - 筛选年龄大于 25 的用户
- `data.users.map(x => x.name)` - 提取所有用户名
- `data.users.find(x => x.city === "上海")` - 查找上海的用户

### 查看树形视图
1. 在编辑器中输入 JSON 数据
2. 点击底部的 "🌲 树形视图" 按钮
3. 右侧会显示可折叠的树形结构

### 转换格式
1. 在编辑器中输入 JSON 数据
2. 点击底部的转换按钮：
   - "📄 转 YAML" - 转换为 YAML 格式
   - "📋 转 XML" - 转换为 XML 格式
3. 右侧会显示转换后的结果
4. 点击 "📋 复制" 按钮复制结果

### 从 YAML/XML 转换
1. 在 Mulby 搜索框直接粘贴 YAML 或 XML 数据
2. 插件会自动识别格式并转换为 JSON
3. 转换后的 JSON 会显示在编辑器中

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

```
json_editor/
├── manifest.json              # 插件配置
├── package.json               # 包配置（pnpm）
├── src/
│   ├── main.ts                # 后端入口
│   ├── ui/
│   │   ├── App.tsx            # 主应用组件
│   │   ├── main.tsx           # React 入口
│   │   ├── index.html         # HTML 模板
│   │   ├── styles.css         # 全局样式
│   │   ├── components/
│   │   │   └── CodeEditor.tsx # CodeMirror 编辑器组件
│   │   ├── utils/
│   │   │   └── formatConverter.ts # 格式转换工具
│   │   └── hooks/
│   │       └── useMulby.ts  # Mulby API Hook
│   └── types/
│       └── mulby.d.ts       # 类型定义
├── dist/                      # 后端构建输出
├── ui/                        # UI 构建输出
└── icon.png                   # 插件图标
```

## 技术栈

- **前端框架**: React 18 + TypeScript
- **代码编辑器**: CodeMirror 6
- **构建工具**: Vite + esbuild
- **转换库**:
  - js-yaml - JSON ↔ YAML 转换
  - fast-xml-parser - JSON ↔ XML 转换
- **样式**: CSS Variables (支持主题切换)

## 特性说明

### CodeMirror 6 编辑器

集成了专业的 CodeMirror 6 代码编辑器，提供：
- 语法高亮
- 代码折叠
- 自动补全
- 括号匹配
- 行号显示
- 搜索和替换
- 多光标编辑
- 撤销/重做

### 格式自动检测

插件会自动检测输入数据的格式：
- 以 `{` 或 `[` 开头 → JSON
- 以 `<` 开头 → XML
- 包含 `:` 且不是 JSON → YAML

检测到非 JSON 格式时，会自动转换为 JSON 并显示在编辑器中。

### XML 转换优化

使用 `fast-xml-parser` 替代 `xml-js`，解决了 Buffer 兼容性问题，支持：
- 属性保留（使用 `@_` 前缀）
- 文本节点保留（使用 `#text` 键名）
- 自动类型转换
- 格式化输出

## 许可证

MIT License
