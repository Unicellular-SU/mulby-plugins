# ip_look

IP 查询插件，用于查询本机 IP 和任意 IP 的地理位置信息。

## 功能特性

- 获取本机公网 IP 及其地理位置信息
- 查询任意 IP 地址的详细信息（国家、城市、运营商、经纬度等）
- 一键复制查询结果字段
- iOS 玻璃拟态风格 UI，支持明暗主题切换
- 免费 API 服务，无需配置

## 触发方式

- 在 Mulby 主界面输入 `ip_look` 打开插件
- 直接输入 IP 地址（如 `8.8.8.8`）后按 Tab 键切换到插件（需配置）

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
ip_look/
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
