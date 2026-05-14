# Mulby Showcase API Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize `plugins/mulby-showcase` so it demonstrates the latest Mulby plugin-facing APIs with clear module boundaries, correct API usage, and no host-internal demo surface.

**Architecture:** Keep this as a React UI plugin with a small backend host process. The UI owns interactive demonstrations, the backend owns lifecycle hooks, dynamic features, scheduler callbacks, messaging handlers, and `rpc` methods exposed through `mulby.host`. API demos are grouped by practical plugin developer workflows, not by every host namespace.

**Tech Stack:** Mulby plugin manifest, TypeScript, React 18, Vite, esbuild, `window.mulby` renderer APIs, `context.api` / global `mulby` backend APIs.

---

## Icon Policy

The showcase UI must not use emoji as icons during this modernization or in future feature work.

- Use `lucide-react` for all in-app icons.
- Import icons as React components from `lucide-react`.
- Store icon references as component types, not emoji strings.
- Use consistent size, stroke width, and color inheritance through CSS.
- Replace all current emoji icons in sidebar entries, page headers, cards, buttons, empty states, status panels, and API snippets with suitable Lucide icons or plain text.
- If Lucide has no exact icon, choose the nearest semantic icon from Lucide instead of introducing another icon library.
- Do not add inline SVGs for ordinary UI icons. Inline SVG is reserved for plugin/package artwork only.

## Source Of Truth

- Current plugin root: `D:\Node.js\mulby-plugins\plugins\mulby-showcase`
- Current host API docs: `D:\Node.js\mulby\docs\apis`
- Current renderer type file: `plugins\mulby-showcase\src\types\mulby.d.ts`
- Current hook file: `plugins\mulby-showcase\src\ui\hooks\useMulby.ts`
- Current left nav: `plugins\mulby-showcase\src\ui\components\Sidebar.tsx`
- Current module mapping: `plugins\mulby-showcase\src\ui\App.tsx`
- Current backend: `plugins\mulby-showcase\src\main.ts`
- Current manifest: `plugins\mulby-showcase\manifest.json`

When docs, local types, and host runtime disagree, trust the actual host docs and runtime first, then update local types or module code to match.

## Scope Rules

This plugin is a developer-facing API showcase. It should demonstrate APIs that third-party plugins can reasonably call.

Do not implement demo modules for host-only or host-settings-only APIs:

- `settings` API body: `settings.get/update/reset/pauseShortcuts/resumeShortcuts/setShortcutRecordingActive/openAtLogin/update-center` are for host settings workflows and should not be showcased here.
- `systemPage`: opening host settings, plugin manager, task scheduler, log viewer, AI settings, and similar system pages belongs to the host UI.
- `systemPlugin`: active system plugin attachment APIs are host/system-plugin infrastructure.
- `superPanel`: Super Panel state/actions are host feature internals.
- `trayMenu`: host tray menu state/action APIs are host UI internals.
- `developer`: plugin path management and reload tooling are host developer settings.
- `pluginStore`: store fetch/install/update flows are host plugin-store settings.
- `onboarding`: setup wizard APIs are host onboarding internals.
- `app` open-system-page events: these events are for host system pages, not ordinary plugin demos.

Renderer lifecycle events such as `window.mulby.onPluginInit`, `onPluginAttach`, `onPluginDetached`, `onPluginOut`, `onThemeChange`, and `onWindowStateChange` are plugin-facing and can be demonstrated where useful.

## Target Module Set

### Primary Left Navigation

Use these modules as the final sidebar shape. Names can be adjusted for UI copy, but responsibilities should stay stable.

1. `system` / "系统与环境"
   - Covers: `system`, `power`, `network`, `geolocation`, `permission`.
   - Keep: system info, app info, paths, idle state, active window, platform checks, file icons, permission checks, geolocation.
   - Remove from this module: host system-page redirects and host settings actions.

2. `clipboard` / "剪贴板"
   - Covers: `clipboard`, `clipboardHistory`.
   - Add: history query, type filter, search, favorite toggle, copy, delete, stats.
   - Manifest needs clipboard permission before using `clipboardHistory`.

3. `input` / "输入与监听"
   - Covers: `input`, `inputMonitor`, `shortcut` where shortcut is demonstrated as user-registered plugin shortcut behavior.
   - Keep: paste/type/image/file automation and keyboard/mouse simulation.
   - Add: global input monitor availability, permission request, start/stop session, event stream preview.
   - Manifest needs `inputMonitor` and, for macOS accessibility-related flows, `accessibility`.

4. `files` / "文件与 Shell"
   - Covers: `filesystem`, `dialog`, `shell`, `desktop`.
   - Keep: open/save dialog, read/write/list/stat/copy/move/delete, open path/folder/external.
   - Add: `shell.runCommand` policy/audit demo only if the manifest declares the permission and UI makes consent/risks obvious.
   - Add: desktop file/app search if available.

5. `network` / "网络"
   - Covers: `http`, `network`.
   - Keep: HTTP methods, network status, IP/network interface checks.

6. `screen` / "屏幕"
   - Covers: `screen`, limited `media` permission checks when needed for capture.
   - Keep: displays, sources, capture, region capture, color pick, coordinate conversion, image editor route.

7. `window` / "窗口与界面"
   - Covers: `window`, `subInput`, `theme`, `menu`, `tray`, plugin lifecycle events.
   - Keep: attached/detached/child windows, bounds, opacity, always-on-top, find-in-page, drag, subInput, context menu, tray create/destroy.
   - Move theme/menu/tray out of old "Settings" wording because this is not host Settings API.

8. `plugin` / "插件编排"
   - Covers plugin-facing parts of `plugin`.
   - Include: `getAll`, `listCommands`, `search`, `run`, `runCommand`, `getRecentUsed`, `redirect`, `outPlugin`, `listCommandShortcuts`, `bindCommandShortcut`, `unbindCommandShortcut`, `validateCommandShortcut`, `setCommandDisabled`, background plugin list/start/stop if docs confirm plugin-facing availability.
   - Exclude: install/uninstall/enable/disable as a primary flow unless the host treats them as ordinary plugin-facing APIs and permissions are declared. These are risky and feel like host plugin manager features.

9. `host-rpc` / "Host RPC"
   - Covers: `host.invoke`, `host.call`, `host.status`, `host.restart`.
   - Backend must expose `export const rpc = { ... }` methods using the latest no-implicit-context signature.
   - Include: simple echo, storage roundtrip, delayed task list, safe backend-only API call.

10. `scheduler` / "任务调度"
    - Covers: `scheduler`.
    - UI: create delay/once/repeat tasks, list tasks, pause/resume/cancel, show executions, validate/describe cron, subscribe to event stream.
    - Backend: exported scheduler callbacks used by created tasks.

11. `messaging` / "插件通信"
    - Covers backend `context.api.messaging`.
    - Use this plugin as both sender and receiver where possible: backend subscribes on load, UI calls backend RPC to send/broadcast test messages, backend stores recent messages in memory or storage for UI polling.

12. `ai` / "AI"
    - Covers: `ai.call`, streaming chunks, `abort(requestId)`, `allModels`, `testConnection`, `testConnectionStream`, `models.fetch`, `tokens.estimate`, `attachments`, `images.generate`, `images.generateStream`, `images.edit`, MCP/skills/tooling discovery where plugin-facing.
    - Include two tool-call demos:
      - Internal per-call tools with `option.tools`, using backend host methods.
      - Optional public plugin tool demo via `manifest.tools` and `context.api.tools.register` only if the showcase should expose a real reusable tool to Mulby AI.
    - Do not implement AI settings editors. Redirecting users to host AI settings is not the purpose of this module.

13. `media` / "媒体处理"
    - Covers: `tts`, `media`, `sharp`, `ffmpeg`.
    - Existing `Media`, `Sharp`, and `FFmpeg` modules can stay separate during migration, then be grouped under a nav category or merged later.

14. `security-storage` / "安全与存储"
    - Covers: `security`, `storage`.
    - Add advanced storage APIs from current types if available: list, has, setMany, getMany, transactions/watch/attachment/encrypted namespaces only where documented and plugin-facing.

15. `attachments` / "附件"
    - Existing `AttachmentsModule` is already implemented and mapped in `App.tsx`, but missing from `Sidebar.tsx`.
    - Add it to the sidebar and keep it focused on search-box attachment payloads.

## Module Reorganization Principles

- Each left-nav item should map to one focused module directory under `src\ui\modules`.
- Shared UI primitives stay under `src\ui\components`.
- Shared demo helpers should live under `src\ui\lib` or `src\ui\modules\<ModuleName>\helpers.ts`, not inline in large components.
- Shared icon mappings should live in `src\ui\modules\registry.ts` or module-local constants and must use `lucide-react` component imports.
- API reference snippets inside modules must match current docs and current `mulby.d.ts`.
- Each module must handle missing API objects gracefully with an unavailable state instead of throwing during render.
- Permission-gated demos must show the permission requirement and fail with a clear message when the manifest permission is missing.
- Avoid "Settings" as a module name unless it means plugin-owned settings. Host settings APIs are out of scope.

## Proposed File Structure

Create or modify these files during implementation:

- Modify: `plugins\mulby-showcase\manifest.json`
  - Add missing feature codes for new modules.
  - Add only needed permissions.
  - Optionally add `tools` if the AI public tool demo is in scope.

- Modify: `plugins\mulby-showcase\src\main.ts`
  - Replace ad-hoc local `PluginContext` typing with local types from `src\types\mulby.d.ts` where practical.
  - Keep lifecycle hooks.
  - Add `export const rpc = { ... }` for host demos.
  - Add scheduler callbacks.
  - Add messaging subscription and message buffer.
  - Register public AI tools only if manifest declares them.

- Modify: `plugins\mulby-showcase\src\ui\App.tsx`
  - Replace manual union growth with a central module registry.
  - Route feature codes to module IDs.
  - Keep special handling for image editor and attachments.

- Modify: `plugins\mulby-showcase\src\ui\components\Sidebar.tsx`
  - Read module entries from the central module registry instead of maintaining a second list.
  - Add `attachments` immediately.

- Create: `plugins\mulby-showcase\src\ui\modules\registry.ts`
  - Single source of truth for sidebar entries, module IDs, labels, icons, feature code aliases, and whether a module is hidden from nav.
  - Icon fields use `LucideIcon` component references from `lucide-react`, not emoji strings.

- Create or refactor:
  - `plugins\mulby-showcase\src\ui\modules\AI\index.tsx`
  - `plugins\mulby-showcase\src\ui\modules\ClipboardHistory\index.tsx` or merge into `Clipboard`
  - `plugins\mulby-showcase\src\ui\modules\InputMonitor\index.tsx` or merge into `Input`
  - `plugins\mulby-showcase\src\ui\modules\PluginOrchestration\index.tsx`
  - `plugins\mulby-showcase\src\ui\modules\HostRPC\index.tsx`
  - `plugins\mulby-showcase\src\ui\modules\Scheduler\index.tsx`
  - `plugins\mulby-showcase\src\ui\modules\Messaging\index.tsx`
  - `plugins\mulby-showcase\src\ui\modules\DesktopSearch\index.tsx` if not merged into FileManager

- Modify: `plugins\mulby-showcase\src\ui\modules\index.ts`
  - Export all new modules.

- Modify existing modules:
  - `SystemInfo`
  - `Clipboard`
  - `Input`
  - `FileManager`
  - `Settings` to become `WindowUI` or equivalent
  - `Security`
  - `Media`
  - `Sharp`
  - `FFmpeg`
  - `WindowAPI`

- Modify: `plugins\mulby-showcase\README.md`
  - Update supported module list, commands, permissions, and manual test notes.

## Implementation Tasks

### Task 1: Add Central Module Registry

**Files:**
- Create: `plugins\mulby-showcase\src\ui\modules\registry.ts`
- Modify: `plugins\mulby-showcase\src\ui\App.tsx`
- Modify: `plugins\mulby-showcase\src\ui\components\Sidebar.tsx`

- [ ] **Step 1: Create the registry with current modules plus planned module IDs**

Use a typed registry. Keep modules that are not implemented yet out of the sidebar until their component exists.

```ts
import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  CalendarClock,
  Clipboard,
  Film,
  FolderOpen,
  Image,
  Keyboard,
  MessageSquare,
  Monitor,
  Network,
  PackageOpen,
  Puzzle,
  ShieldCheck,
  Terminal,
  Volume2,
  WandSparkles,
  Window,
} from 'lucide-react'

export type ModuleId =
  | 'system'
  | 'clipboard'
  | 'input'
  | 'files'
  | 'network'
  | 'screen'
  | 'media'
  | 'window-ui'
  | 'child-window'
  | 'inbrowser'
  | 'sharp'
  | 'ffmpeg'
  | 'security-storage'
  | 'attachments'
  | 'plugin'
  | 'host-rpc'
  | 'scheduler'
  | 'messaging'
  | 'ai'

export interface ModuleEntry {
  id: ModuleId
  label: string
  icon: LucideIcon
  featureCodes: string[]
  nav: boolean
}

export const moduleRegistry: ModuleEntry[] = [
  { id: 'system', icon: Monitor, label: '系统与环境', featureCodes: ['main', 'sysinfo'], nav: true },
  { id: 'clipboard', icon: Clipboard, label: '剪贴板', featureCodes: ['clipboard'], nav: true },
  { id: 'input', icon: Keyboard, label: '输入与监听', featureCodes: ['input'], nav: true },
  { id: 'files', icon: FolderOpen, label: '文件与 Shell', featureCodes: ['files'], nav: true },
  { id: 'network', icon: Network, label: '网络', featureCodes: ['network'], nav: true },
  { id: 'screen', icon: Monitor, label: '屏幕', featureCodes: ['screen', 'screenshot'], nav: true },
  { id: 'media', icon: Volume2, label: '媒体', featureCodes: ['media'], nav: true },
  { id: 'window-ui', icon: Window, label: '窗口与界面', featureCodes: ['window-ui'], nav: true },
  { id: 'child-window', icon: Image, label: 'Child Window', featureCodes: [], nav: true },
  { id: 'inbrowser', icon: Bot, label: 'InBrowser', featureCodes: ['showcase:inbrowser'], nav: true },
  { id: 'sharp', icon: Image, label: 'Sharp 图像', featureCodes: ['showcase:sharp'], nav: true },
  { id: 'ffmpeg', icon: Film, label: 'FFmpeg 音视频', featureCodes: ['showcase:ffmpeg'], nav: true },
  { id: 'security-storage', icon: ShieldCheck, label: '安全与存储', featureCodes: ['security-storage'], nav: true },
  { id: 'attachments', icon: PackageOpen, label: '附件', featureCodes: ['attachments'], nav: true },
  { id: 'plugin', icon: Puzzle, label: '插件编排', featureCodes: ['plugin'], nav: false },
  { id: 'host-rpc', icon: Terminal, label: 'Host RPC', featureCodes: ['host-rpc'], nav: false },
  { id: 'scheduler', icon: CalendarClock, label: '任务调度', featureCodes: ['scheduler'], nav: false },
  { id: 'messaging', icon: MessageSquare, label: '插件通信', featureCodes: ['messaging'], nav: false },
  { id: 'ai', icon: WandSparkles, label: 'AI', featureCodes: ['ai'], nav: false },
]

export const featureToModule = Object.fromEntries(
  moduleRegistry.flatMap((entry) => entry.featureCodes.map((code) => [code, entry.id]))
) as Record<string, ModuleId>
```

- [ ] **Step 2: Update `Sidebar.tsx` to render registry entries**

Import `moduleRegistry`, filter `nav`, and remove the local `modules` array.

Render the icon component:

```tsx
const Icon = module.icon

<Icon className="icon" aria-hidden="true" size={16} strokeWidth={2} />
```

- [ ] **Step 3: Update `App.tsx` to use the registry `ModuleId` and `featureToModule`**

Map old component keys to new IDs:

```ts
const moduleComponents: Record<ModuleId, React.ComponentType<any>> = {
  system: SystemInfoModule,
  clipboard: ClipboardModule,
  input: InputModule,
  files: FileManagerModule,
  network: NetworkModule,
  screen: ScreenModule,
  media: MediaModule,
  'window-ui': SettingsModule,
  'child-window': ChildWindowModule,
  inbrowser: InBrowserDemo,
  sharp: SharpModule,
  ffmpeg: FFmpegModule,
  'security-storage': SecurityModule,
  attachments: AttachmentsModule,
}
```

- [ ] **Step 4: Build**

Run:

```powershell
npm run build
```

Working directory:

```powershell
D:\Node.js\mulby-plugins\plugins\mulby-showcase
```

Expected: backend bundle and Vite build complete without TypeScript or module resolution errors.

### Task 2: Clean Up Existing Module Boundaries

**Files:**
- Modify: `plugins\mulby-showcase\src\ui\modules\Settings\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\SystemInfo\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\FileManager\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\Input\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\Security\index.tsx`

- [ ] **Step 1: Rename the user-facing Settings module**

Change the page title from "高级设置" to "窗口与界面". This module demonstrates plugin window/theme/menu/tray APIs, not host Settings API.

- [ ] **Step 2: Keep host Settings API out**

Search:

```powershell
rg -n "\bsettings\." src
```

Expected after cleanup: no module calls `window.mulby.settings.*`. Code snippets must not suggest `settings.get/update/reset`.

- [ ] **Step 3: Keep host-only pages out**

Search:

```powershell
rg -n "systemPage|systemPlugin|superPanel|trayMenu|developer|pluginStore|onboarding" src
```

Expected: no UI demo module imports or calls these APIs.

- [ ] **Step 4: Split oversized API cards**

For each existing module, keep cards grouped by workflow:

- SystemInfo: system info, app info, paths, permissions, geolocation, power/network.
- Input: paste/type automation, keyboard/mouse simulation, input monitor.
- FileManager: filesystem, dialog, shell, desktop search.
- Security: security encryption, storage, encrypted/attachment storage if implemented.
- Window UI: window controls, child window launch, subInput, theme, context menu, tray, plugin lifecycle.

- [ ] **Step 5: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

### Task 3: Replace Emoji Icons With Lucide Icons

Status: completed on 2026-05-10. `lucide-react` has been added to the project and the current UI/README emoji markers have been replaced with Lucide SVG icons or plain text.

**Files:**
- Modify: `plugins\mulby-showcase\src\ui\components\PageHeader.tsx` or the local header component file if named differently
- Modify: `plugins\mulby-showcase\src\ui\components\Card.tsx` or the local card component file if named differently
- Modify: `plugins\mulby-showcase\src\ui\components\Sidebar.tsx`
- Modify: every file under `plugins\mulby-showcase\src\ui\modules`
- Modify: `plugins\mulby-showcase\src\ui\styles.css`

- [x] **Step 1: Update component props**

Change header/card props from string emoji icons to optional Lucide icon components.

Use this shape:

```ts
import type { LucideIcon } from 'lucide-react'

interface IconProps {
  icon?: LucideIcon
}
```

Render with:

```tsx
{Icon ? <Icon className="section-icon" aria-hidden="true" size={18} strokeWidth={2} /> : null}
```

- [x] **Step 2: Add CSS for SVG icons**

Add shared classes:

```css
.icon,
.section-icon,
.card-icon {
  display: inline-flex;
  flex: 0 0 auto;
  color: currentColor;
}
```

- [x] **Step 3: Replace module-level emoji icons**

Use Lucide imports. Suggested mapping:

```ts
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  Clipboard,
  Copy,
  FileText,
  FolderOpen,
  Image,
  Keyboard,
  Lock,
  Monitor,
  MousePointerClick,
  Network,
  Play,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Volume2,
  Window,
} from 'lucide-react'
```

Pick semantic icons per card or action; do not use emoji as fallback.

- [x] **Step 4: Replace decorative emoji in visible text**

Search:

```powershell
rg -n "[^\x00-\x7F]" src\ui
```

This will also find Chinese text. Inspect results and remove emoji characters from JSX visible text, button labels, empty states, and code snippets. Keep Chinese UI text.

- [x] **Step 5: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Open every existing sidebar module.
- Confirm sidebar, headers, cards, buttons, and empty states show SVG icons instead of emoji.
- Confirm icon alignment and text spacing are consistent in light and dark themes.

### Task 4: Add Clipboard History

**Files:**
- Modify: `plugins\mulby-showcase\manifest.json`
- Modify: `plugins\mulby-showcase\src\ui\modules\Clipboard\index.tsx`

- [ ] **Step 1: Add clipboard permission**

Add:

```json
"permissions": {
  "clipboard": true
}
```

If `permissions` already exists when this task runs, merge the key instead of replacing other permissions.

- [ ] **Step 2: Add history state and controls**

Add controls for:

- type filter: all/text/image/files
- search text
- favorite-only toggle
- limit
- refresh button
- stats button

- [ ] **Step 3: Implement safe calls**

Use `clipboardHistory` only when present:

```ts
const { clipboard, clipboardHistory } = useMulby()

if (!clipboardHistory) {
  notify.warning('clipboardHistory API 不可用')
  return
}
```

- [ ] **Step 4: Implement row actions**

Each row supports:

- copy: `clipboardHistory.copy(item.id)`
- favorite toggle: `clipboardHistory.toggleFavorite(item.id)`
- delete: `clipboardHistory.delete(item.id)`

- [ ] **Step 5: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test inside Mulby:

- Open `showcase`.
- Select "剪贴板".
- Copy text in another app.
- Refresh history.
- Search copied text.
- Toggle favorite.
- Copy a history row back to clipboard.

### Task 5: Add Input Monitor

**Files:**
- Modify: `plugins\mulby-showcase\manifest.json`
- Modify: `plugins\mulby-showcase\src\ui\modules\Input\index.tsx`

- [ ] **Step 1: Add permissions**

Merge:

```json
"permissions": {
  "inputMonitor": true,
  "accessibility": true
}
```

- [ ] **Step 2: Add monitor state**

Track:

- `available`
- `sessionId`
- `events`
- `mouse`
- `keyboard`
- `throttleMs`
- `listening`

- [ ] **Step 3: Add availability and permission actions**

Use:

```ts
await inputMonitor.isAvailable()
await inputMonitor.requireAccessibility()
```

- [ ] **Step 4: Add start/stop**

Renderer pattern:

```ts
const sid = await inputMonitor.start({ mouse, keyboard, throttleMs })
const cleanup = inputMonitor.onEvent((event) => {
  setEvents((prev) => [event, ...prev].slice(0, 30))
})
await inputMonitor.stop(sid)
cleanup()
```

Store `cleanup` in a `useRef` and clean it up on unmount.

- [ ] **Step 5: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Open "输入与监听".
- Start keyboard-only monitor.
- Press a few keys outside Mulby.
- Confirm events appear.
- Stop monitor and confirm no new events are appended.

### Task 6: Add Host RPC Demo

**Files:**
- Modify: `plugins\mulby-showcase\src\main.ts`
- Create: `plugins\mulby-showcase\src\ui\modules\HostRPC\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\index.ts`
- Modify: `plugins\mulby-showcase\src\ui\modules\registry.ts`
- Modify: `plugins\mulby-showcase\src\ui\App.tsx`

- [ ] **Step 1: Add backend `rpc` namespace**

Use latest recommended no-context-offset style:

```ts
export const rpc = {
  async echo(input: { text: string }) {
    return {
      text: input.text,
      length: input.text.length,
      at: new Date().toISOString(),
    }
  },

  async getBackendStatus() {
    return {
      ok: true,
      pid: process.pid,
      at: new Date().toISOString(),
    }
  },

  async notify(message: string) {
    await mulby.notification.show(message || 'Host RPC notify')
    return { success: true }
  },
}
```

- [ ] **Step 2: Add UI module**

Use `useMulby('mulby-showcase')` and call:

```ts
await host.status()
await host.call('echo', { text })
await host.call('getBackendStatus')
await host.call('notify', text)
await host.invoke('clipboard.readText')
```

- [ ] **Step 3: Register module**

Add `host-rpc` to the registry, exports, and component map.

- [ ] **Step 4: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Open "Host RPC".
- Check backend status.
- Send echo.
- Trigger backend notification.
- Read clipboard through `host.invoke`.

### Task 7: Add Scheduler Demo

**Files:**
- Modify: `plugins\mulby-showcase\src\main.ts`
- Create: `plugins\mulby-showcase\src\ui\modules\Scheduler\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\index.ts`
- Modify: `plugins\mulby-showcase\src\ui\modules\registry.ts`
- Modify: `plugins\mulby-showcase\src\ui\App.tsx`
- Modify: `plugins\mulby-showcase\manifest.json`

- [ ] **Step 1: Add scheduler callbacks in backend**

Add exported callback functions:

```ts
export async function onShowcaseDelayTask(payload?: { message?: string }) {
  await mulby.notification.show(payload?.message || 'Showcase delay task executed')
}

export async function onShowcaseRepeatTask(payload?: { message?: string }) {
  await mulby.notification.show(payload?.message || 'Showcase repeat task executed')
}
```

- [ ] **Step 2: Add RPC helpers**

Add to `rpc`:

```ts
async scheduleDelayTask(input: { delayMs: number; message: string }) {
  return await mulby.scheduler.schedule({
    name: 'Showcase Delay Task',
    type: 'delay',
    delay: input.delayMs,
    callback: 'onShowcaseDelayTask',
    payload: { message: input.message },
  })
}
```

- [ ] **Step 3: Add UI module**

Renderer covers:

- `scheduler.subscribe()`
- `scheduler.onEvent(callback)`
- `scheduler.listTasks({ limit: 20 })`
- `scheduler.getTask(taskId)`
- `scheduler.cancelTask(taskId)`
- `scheduler.pauseTask(taskId)`
- `scheduler.resumeTask(taskId)`
- `scheduler.validateCron(expression)`
- `scheduler.describeCron(expression)`
- `scheduler.getNextCronTime(expression)`

Creation uses backend RPC because docs mark `schedule(task)` as backend.

- [ ] **Step 4: Add feature**

Add feature code:

```json
{
  "code": "scheduler",
  "explain": "任务调度 API",
  "cmds": [
    { "type": "keyword", "value": "scheduler" },
    { "type": "keyword", "value": "任务调度" }
  ]
}
```

- [ ] **Step 5: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Open "任务调度".
- Create a 5-second delay task.
- Confirm notification fires.
- Refresh task list.
- Validate a cron expression.
- Subscribe to events and confirm task events appear.

### Task 8: Add Messaging Demo

**Files:**
- Modify: `plugins\mulby-showcase\src\main.ts`
- Create: `plugins\mulby-showcase\src\ui\modules\Messaging\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\index.ts`
- Modify: `plugins\mulby-showcase\src\ui\modules\registry.ts`
- Modify: `plugins\mulby-showcase\src\ui\App.tsx`

- [ ] **Step 1: Add backend message buffer**

Use module-level memory:

```ts
const recentMessages: Array<{
  id: string
  from: string
  to?: string
  type: string
  payload: unknown
  timestamp: number
}> = []
```

- [ ] **Step 2: Subscribe in `onLoad`**

Use `context.api.messaging` if available:

```ts
context?.api.messaging?.on((message) => {
  recentMessages.unshift(message)
  recentMessages.splice(50)
})
```

- [ ] **Step 3: Add RPC methods**

```ts
async sendMessage(input: { targetPluginId: string; type: string; payload: unknown }) {
  await mulby.messaging.send(input.targetPluginId, input.type, input.payload)
  return { success: true }
},
async broadcastMessage(input: { type: string; payload: unknown }) {
  await mulby.messaging.broadcast(input.type, input.payload)
  return { success: true }
},
async getRecentMessages() {
  return recentMessages
}
```

- [ ] **Step 4: Add UI module**

Include:

- target plugin ID input
- message type input
- JSON payload textarea
- send button
- broadcast button
- recent messages refresh button
- JSON parse error display

- [ ] **Step 5: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Open "插件通信".
- Broadcast a `showcase-test` message.
- Refresh recent messages.
- Confirm the message appears if self-delivery is supported, or document that broadcasts exclude the sender.

### Task 9: Add Plugin Orchestration Demo

**Files:**
- Create: `plugins\mulby-showcase\src\ui\modules\PluginOrchestration\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\index.ts`
- Modify: `plugins\mulby-showcase\src\ui\modules\registry.ts`
- Modify: `plugins\mulby-showcase\src\ui\App.tsx`
- Modify: `plugins\mulby-showcase\manifest.json`

- [ ] **Step 1: Add UI module**

Include safe plugin-facing actions:

- `plugin.getAll()`
- `plugin.listCommands()`
- `plugin.search(query)`
- `plugin.run(pluginName, featureCode, input)`
- `plugin.runCommand({ pluginId, featureCode, input })`
- `plugin.getRecentUsed(limit)`
- `plugin.redirect(labelOrTuple, payload)`
- `plugin.outPlugin(false)`
- command shortcut list/validate/bind/unbind

- [ ] **Step 2: Avoid plugin-manager actions**

Do not include primary buttons for:

- install
- uninstall
- enable
- disable
- plugin store update

If a code snippet references these APIs, remove it.

- [ ] **Step 3: Add feature**

Add:

```json
{
  "code": "plugin",
  "explain": "插件编排 API",
  "cmds": [
    { "type": "keyword", "value": "plugin api" },
    { "type": "keyword", "value": "插件编排" }
  ]
}
```

- [ ] **Step 4: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Search current plugins.
- Run a harmless feature from the showcase itself.
- Validate a shortcut without binding it first.
- Redirect to a known command if one exists.

### Task 10: Add AI Demo

**Files:**
- Modify: `plugins\mulby-showcase\src\main.ts`
- Create: `plugins\mulby-showcase\src\ui\modules\AI\index.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\index.ts`
- Modify: `plugins\mulby-showcase\src\ui\modules\registry.ts`
- Modify: `plugins\mulby-showcase\src\ui\App.tsx`
- Modify: `plugins\mulby-showcase\manifest.json`

- [ ] **Step 1: Add backend tool helper methods**

Add to `rpc`:

```ts
async getShowcaseTime() {
  return { now: new Date().toISOString() }
},
async getShowcaseEcho(input: { text: string }) {
  return { echoed: input.text }
}
```

- [ ] **Step 2: Build streaming text call UI**

Renderer must follow the documented abort pattern:

- Store `requestId` from the first chunk's `__requestId`.
- Store `abortedRef`.
- Stop with `ai.abort(requestId)`.
- Ignore later chunks after abort.

- [ ] **Step 3: Add model and connection checks**

Include:

- `ai.allModels()`
- `ai.testConnection({ model })`
- `ai.testConnectionStream(input, onChunk)` if available in current types.

- [ ] **Step 4: Add token estimate**

Use:

```ts
await ai.tokens.estimate({
  model,
  messages: [{ role: 'user', content: prompt }],
})
```

- [ ] **Step 5: Add internal tool-call demo**

Use `option.tools` for per-call tools. Do not require `manifest.tools` for this internal demo.

- [ ] **Step 6: Add attachment/image demos only behind availability checks**

Use:

- `ai.attachments.upload`
- `ai.attachments.get`
- `ai.attachments.delete`
- `ai.images.generate`
- `ai.images.generateStream`
- `ai.images.edit`

If the host has no configured image-capable model, show a clear unavailable state.

- [ ] **Step 7: Avoid settings APIs**

Do not call `ai.settings.*`, `ai.mcp.upsertServer`, `ai.skills.install/remove/enable/disable`, or web search provider update APIs from this showcase unless a later product decision explicitly expands scope. Read-only listing of models, MCP servers, skills, and tool availability is acceptable.

- [ ] **Step 8: Add feature**

Add:

```json
{
  "code": "ai",
  "explain": "AI API",
  "cmds": [
    { "type": "keyword", "value": "ai" },
    { "type": "keyword", "value": "AI 示例" }
  ]
}
```

- [ ] **Step 9: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Open "AI".
- List models.
- Run a small non-stream call.
- Run streaming call and stop it.
- Estimate tokens.
- Run internal tool demo.

### Task 11: Add Desktop Search To File Module

**Files:**
- Modify: `plugins\mulby-showcase\src\ui\modules\FileManager\index.tsx`

- [ ] **Step 1: Add desktop search card**

Use:

```ts
await desktop.searchFiles(query, limit)
await desktop.searchApps(query, limit)
```

- [ ] **Step 2: Add shell open actions for results**

For file results:

```ts
await shell.showItemInFolder(path)
```

For app/file results where safe:

```ts
await shell.openPath(path)
```

- [ ] **Step 3: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Search a known file name.
- Search a known app name.
- Reveal a file in folder.

### Task 12: Expand Storage Demo

**Files:**
- Modify: `plugins\mulby-showcase\src\ui\modules\Security\index.tsx`

- [ ] **Step 1: Keep basic key-value demo**

Maintain existing `get/set/remove`.

- [ ] **Step 2: Add advanced storage only where current API docs and types agree**

Candidate methods from current type file:

- `keys`
- `list`
- `has`
- `setMany`
- `getMany`
- `removeMany`
- `clear`
- `encrypted.*`
- `attachment.*`

If a method exists only in local types but not in current docs, verify in runtime before showing it as stable.

- [ ] **Step 3: Add version/conflict UI if CAS is supported**

For methods supporting `expectedVersion`, add a small concurrency demo:

- read key and version
- update with expected version
- show conflict result when version mismatches

- [ ] **Step 4: Build and manual verify**

Run:

```powershell
npm run build
```

Manual test:

- Save JSON.
- List stored keys.
- Save encrypted value.
- Store and retrieve a small text attachment if supported.

### Task 13: Manifest Feature And Permission Pass

**Files:**
- Modify: `plugins\mulby-showcase\manifest.json`
- Modify: `plugins\mulby-showcase\src\main.ts`
- Modify: `plugins\mulby-showcase\src\ui\App.tsx`
- Modify: `plugins\mulby-showcase\src\ui\modules\registry.ts`

- [ ] **Step 1: Ensure every nav module has a feature code when useful**

At minimum:

- `main`
- `sysinfo` or `system`
- `clipboard`
- `input`
- `files`
- `network`
- `screen`
- `media`
- `window-ui`
- `security-storage`
- `attachments`
- `plugin`
- `host-rpc`
- `scheduler`
- `messaging`
- `ai`

- [ ] **Step 2: Ensure every feature maps to a module**

Add each feature code to `featureCodes` in `registry.ts`.

- [ ] **Step 3: Keep dynamic features current**

In `main.ts`, keep dynamic features that demonstrate plugin-facing `features` API:

- silent date
- silent reverse
- platform-filtered feature
- refresh dynamic features
- UI route
- detached route

Also add a MainPush example if current docs confirm the callback signature and it is plugin-facing.

- [ ] **Step 4: Merge permissions conservatively**

Candidate permissions:

```json
"permissions": {
  "clipboard": true,
  "screen": true,
  "inputMonitor": true,
  "accessibility": true,
  "runCommand": true
}
```

Only add `runCommand` if the Shell command demo is implemented. Do not add broad permissions for APIs that are not shown.

- [ ] **Step 5: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds and manifest remains valid JSON.

### Task 14: Documentation Pass

**Files:**
- Modify: `plugins\mulby-showcase\README.md`
- Keep: `plugins\mulby-showcase\docs\2026-05-10-api-modernization-plan.md`

- [ ] **Step 1: Update README feature list**

Include every final module, commands, and permissions.

- [ ] **Step 2: Add manual testing checklist**

Add a section:

```md
## Manual Acceptance Checklist

- Open `showcase` from Mulby search.
- Open every sidebar module.
- Trigger every manifest feature keyword.
- Verify permission-gated demos show clear errors when permissions are missing.
- Verify AI streaming can be aborted.
- Verify scheduler delay task fires.
- Verify host RPC calls return data.
- Verify build and pack succeed.
```

- [ ] **Step 3: Document excluded APIs**

Add a short note:

```md
This showcase intentionally excludes host-only APIs such as Settings API body, System Page, System Plugin, Super Panel, Tray Menu, Developer, Plugin Store, and Onboarding APIs.
```

- [ ] **Step 4: Build and pack**

Run:

```powershell
npm run build
npm run pack
```

Expected: build succeeds and `.inplugin` package is produced by Mulby CLI.

## Final Verification Commands

Run from:

```powershell
D:\Node.js\mulby-plugins\plugins\mulby-showcase
```

Commands:

```powershell
npm run build
npm run pack
```

Search checks:

```powershell
rg -n "window\.mulby\.settings|systemPage|systemPlugin|superPanel|trayMenu|developer|pluginStore|onboarding" src
rg -n "settings\.get|settings\.update|settings\.reset" src README.md docs
rg -n "[^\x00-\x7F]" src\ui
```

Expected:

- First search has no demo code hits for excluded namespaces.
- Second search has no implementation or API-reference snippets for host Settings API body.
- Third search should be reviewed to ensure any non-ASCII findings are Chinese text or other intentional non-emoji content, not emoji icons.
- Build succeeds.
- Pack succeeds.

## Manual Acceptance Checklist

- Open Mulby and trigger `showcase`.
- Sidebar includes "附件".
- Sidebar, page headers, cards, buttons, and empty states use `lucide-react` SVG icons, not emoji.
- No sidebar item is named "高级设置" if it only demonstrates window/theme/menu/tray APIs.
- Every sidebar item renders without crashing when an API is unavailable.
- Permission-gated modules explain required manifest permissions.
- Clipboard history can query and copy a record.
- Input monitor can start and stop.
- Scheduler delay task fires a notification.
- Host RPC echo returns backend data.
- Messaging module can send or broadcast a test message without crashing.
- AI streaming call can be stopped via `ai.abort(requestId)`.
- Plugin orchestration can search commands and run a harmless feature.
- File module can do desktop search if host supports it.
- No module exposes host Settings API body, System Page, System Plugin, Super Panel, Tray Menu, Developer, Plugin Store, or Onboarding APIs as a demo.

## Suggested Commit Sequence

1. `refactor(showcase): centralize module registry`
2. `refactor(showcase): replace emoji icons with lucide icons`
3. `refactor(showcase): clarify existing module boundaries`
4. `feat(showcase): add clipboard history demo`
5. `feat(showcase): add input monitor demo`
6. `feat(showcase): add host rpc demo`
7. `feat(showcase): add scheduler demo`
8. `feat(showcase): add messaging demo`
9. `feat(showcase): add plugin orchestration demo`
10. `feat(showcase): add ai api demo`
11. `feat(showcase): add desktop search and storage demos`
12. `docs(showcase): update readme and acceptance checklist`

Each commit should build before moving to the next task.
