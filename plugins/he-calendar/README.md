# 合社日历

> 有温度的中国风日历🍵 - 支持网页与 Mulby 插件
>
> [开源地址](https://github.com/scutken/he-calendar) | [在线示例](https://cal.heshe.tech)

## 应用介绍

合社日历是一款融合中国传统文化元素的精美日历插件，专为 Mulby 用户设计。它不仅是一个简单的日历工具，更是一个能让你感受中国传统文化魅力的数字艺术品。

### ✨ 核心特色

- **🎨 24节气智能主题**：根据当前节气自动切换配色，每个节气都有独特的中国传统色彩
- **📅 农历与黄历**：完整的农历信息、节气、传统节日和黄历宜忌
- **🌈 多样主题风格**：提供素雅、水墨、朱红、鎏金、黛蓝等多种主题，满足不同审美需求
- **⚡ 流畅交互体验**：支持滚轮切换月份、快速选择年月、一键回到今天
- **📆 详细日历信息**：显示节假日、调休信息、干支纪年、五行、冲煞、彭祖百忌等
- **🎯 精准定位**：快速查看任意日期与今天的时间距离

### 🎨 24节气主题

合社日历根据中国传统24节气，为每个节气精心挑选了对应的中国传统色彩：

- 春季：立春（春黄）、雨水（雨绿）、惊蛰（桃红）、春分（春蓝）、清明（桐绿）、谷雨（羽紫）
- 夏季：立夏（夏黄）、小满（满红）、芒种（麦黄）、夏至（星云）、小暑（晨紫）、大暑（萤黑）
- 秋季：立秋（蝉绿）、处暑（谷蓝）、白露（鹟黄）、秋分（秋紫）、寒露（菊红）、霜降（柿红）
- 冬季：立冬（冬黄）、小雪（雪青）、大雪（雪白）、冬至（冬蓝）、小寒（寒青）、大寒（寒紫）

### 📖 黄历功能

选择任意日期，右侧面板会显示详细的黄历信息：

- **基本信息**：公历日期、农历日期、生肖年、干支纪年
- **宜忌事项**：当日适宜和忌讳的事项
- **其他信息**：五行纳音、冲煞、彭祖百忌、胎神方位等传统信息

### 🚀 快速使用

**Mulby 插件**：在 Mulby 中通过以下关键词唤起插件：

- `日历`
- `万年历`
- `黄历`
- `calendar`

**Mulby AI 工具**：插件还为 AI 助手提供了 5 个工具接口：

- `get_date_info` — 查询日历信息（公历、农历、节气、节日等）
- `get_almanac` — 查询黄历宜忌
- `get_festivals` — 查询日期范围内的节日
- `search_next_festival` — 查找下一个指定节日
- `get_shichen` — 查询十二时辰吉凶

### 🚀 部署

**Mulby 插件打包**：

```bash
npm install
npm run build       # 构建 dist/main.js + ui/index.html
npm run pack        # 生成 he-calendar-{version}.inplugin
```

**静态站点部署**：推荐部署到腾讯云 EdgeOne Pages：

1. 在 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages) 新建项目并关联 GitHub 仓库
2. 构建命令：`npm run build:ui`
3. 输出目录：`ui`
4. Node 版本：`20`
5. 推送到默认分支即自动构建并全球分发

也可以使用任何静态托管平台（GitHub Pages、Cloudflare Pages、Netlify 等），只需把 `ui` 目录作为产物即可。

### 💡 操作指南

- **切换月份**：使用鼠标滚轮上下滚动，或点击左右箭头按钮
- **选择年份**：点击顶部年份，在下拉面板中选择或滚轮切换
- **选择月份**：点击顶部月份，在下拉面板中快速选择
- **回到今天**：点击"今天"按钮
- **切换主题**：点击调色板图标，选择喜欢的主题
- **查看详情**：点击任意日期，在右侧查看详细信息

## 技术栈

- **Vue 3**：现代化的渐进式 JavaScript 框架
- **Vite**：下一代前端构建工具
- **EdgeOne Pages**：腾讯云边缘静态站点托管
- **Day.js**：轻量级日期处理库
- **tyme4ts**：强大的农历、节气、黄历计算库（6tail）
- **Lucide Vue Next**：精美的图标库

## 版本说明

详细版本说明请查看 [版本说明.txt](版本说明.txt)

---

## 开源协议

本项目基于 MIT 协议开源。

## 致谢

感谢以下开源项目：

- [Vue.js](https://vuejs.org/)
- [Vite](https://vitejs.dev/)
- [tyme4ts](https://github.com/6tail/tyme4ts)
- [Day.js](https://day.js.org/)
- [Lucide Icons](https://lucide.dev/)

---

**用心感受时间的温度，让传统文化融入日常 🌸**

## Mulby 迁移说明

本插件已从 uTools 迁移至 Mulby。以下为 API 变更摘要：

| uTools API | Mulby 替代 | 说明 |
|---|---|---|
| `window.utools.onPluginEnter` | `window.mulby.onPluginInit` | 事件数据结构略有不同 |
| `window.utools.dbStorage.getItem/setItem` | `window.mulby.storage.get/set` | Mulby 存储为异步接口 |
| `window.utools.shellOpenExternal` | `window.mulby.shell.openExternal` | 功能等价 |
| `utools.registerTool` | `context.api.tools.register` (backend) | 工具注册移至 backend `src/main.ts` |

### 已知差异

- 原 uTools `dbStorage` 为同步接口，Mulby `storage` 为异步接口，已调整所有调用点
- 插件 icon 沿用原 `logo.png`，后续可替换为更适配 Mulby 风格的版本

### Mulby 手动验收清单

1. 在 Mulby 中输入 "日历" / "万年历" / "黄历" / "calendar" 能正常唤起插件
2. 日历界面完整显示，滚轮切换月份正常
3. 主题切换、周起始日、节日显示等设置可正常保存并在重启后保持
4. 深浅色模式切换正常
5. 外部链接（GitHub、网页版、百度百科）可正常在系统浏览器中打开
6. AI 工具（get_date_info、get_almanac、get_festivals、search_next_festival、get_shichen）返回正确数据
7. Icon 在 Mulby 插件列表中显示正确
