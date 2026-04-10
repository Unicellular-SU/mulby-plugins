# pdf-tools

插件描述

## 功能特性

- 功能 1
- 功能 2
- 功能 3

## 触发方式

- `pdf-tools` - 主功能

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
pdf-tools/
├── manifest.json              # 插件配置
├── package.json
├── src/
│   ├── main.ts                # 后端入口
│   ├── ui/
│   │   ├── App.tsx            # 主应用
│   │   ├── main.tsx           # UI 入口
│   │   ├── index.html         # HTML 模板
│   │   ├── styles.css         # 全局样式
│   │   ├── hooks/
│   │   │   └── useMulby.ts  # Mulby API Hook
│   │   └── types/
│   │       └── mulby.d.ts   # 类型定义
├── dist/                      # 后端构建输出
├── ui/                        # UI 构建输出
└── icon.png                   # 插件图标
```

## 许可证

MIT License
