# Mulby Plugin Development Guide

> **Contexts**: `UI` = `window.mulby.{module}`, `Main` = `context.api.{module}`. Most APIs are available in both contexts (marked as **R/B**).

## 1. Project Structure

```text
my-plugin/
├── manifest.json       # Plugin Configuration (Manifest V2)
├── package.json        # Dependencies (React, Vite, etc.)
├── tsconfig.json       # TypeScript Configuration
├── vite.config.ts      # Vite Configuration
├── preload.cjs         # Node.js Bridge (Optional, MUST be .cjs)
├── src/
│   ├── main.ts         # Backend Logic (Node.js context)
│   └── ui/             # Frontend Logic (React context)
│       ├── main.tsx    # Entry Point
│       ├── App.tsx     # Main Component
│       ├── styles.css  # Styles
│       ├── hooks/      # Custom Hooks
│       │   └── useMulby.ts
│       └── vite-env.d.ts
└── assets/             # Icons, etc.
```

## 1.1 Entry Points & Patterns

**Backend (`src/main.ts`)**:
```typescript
interface PluginContext {
  api: { clipboard: any; notification: any; /* ... */ }
  input?: string;      // Initial input (if triggered by text)
  featureCode?: string; // Feature code structure
}

// Lifecycle Hooks within export
export function onLoad() { /* Plugin Loaded */ }
export function onUnload() { /* Plugin Unloaded */ }
export async function run(context: PluginContext) {
  const { notification } = context.api;
  notification.show('Plugin Started');
}
export default { onLoad, onUnload, run };
```

**Frontend (`src/ui/App.tsx`)**:
```typescript
import { useMulby } from './hooks/useMulby';

export default function App() {
  const { clipboard, notification } = useMulby(); // Use provided hook
  // ...
}
```

## 2. Manifest Configuration (`manifest.json`)

```json
{
  "name": "my-plugin",          // Unique ID (required)
  "displayName": "My Plugin",   // UI Name (required)
  "version": "1.0.0",
  "author": "Your Name",
  "type":"utility/productivity/developer/system/media/network/ai/entertainment/other",
  "homepage": "https://github.com/...",
  "description": "Plugin description",
  "main": "dist/main.js",       // Backend Entry (required)
  "ui": "ui/index.html",        // UI Entry (required for UI plugins)
  "preload": "preload.cjs",     // Preload path (optional)
  "icon": "icon.png",           // Logo path
  "pluginSetting": {
    "single": true,             // Run as singleton (no multi-window)
    "height": 400               // Initial height
  },
  "window": {                   // Detached window config
    "width": 800,
    "height": 600,
    "minWidth": 400,
    "minHeight": 300
  },
  "features": [                 // Feature list
    {
      "code": "format",
      "explain": "Format JSON",
      "cmds": [
        // Keyword Trigger
        { "type": "keyword", "value": "json" },
        // Regex Trigger
        { "type": "regex", "match": "^\\{.*\\}$", "minLength": 2 },
        // File Trigger
        { "type": "files", "exts": [".json"], "fileType": "file" },
        // Image Trigger
        { "type": "img", "exts": [".png", ".jpg"] },
        // Text Selection Trigger
        { "type": "over", "label": "Format Selection", "minLength": 1 }
      ],
      "mainPush": true,         // Push content to search bar
      "mainHide": true          // Hide main window on trigger
    }
  ]
}
```

### Plugin & Window Settings
| Field | Type | Default | Description |
|---|---|---|---|
| `pluginSetting.single` | bool | `true` | Prevent multiple instances |
| `pluginSetting.height` | number | - | Initial height |
| `window.width` / `height` | number | 500/400 | Default size (detached) |
| `window.minWidth` / `Height` | number | 300/200 | Minimum size |
| `window.maxWidth` / `Height` | number | - | Maximum size |

### Icon Configuration
- **Formats**: Path (`"icon.png"`), URL (`"https://..."`), Emoji (`"🚀"`), or SVG Code (`"<svg>..."`).
- **Object Notation**: `{ "type": "file", "value": "path/to/icon.png" }`.

### Feature Configuration (`features`)
| Field | Type | Description |
|---|---|---|
| `code` | string | Unique feature identifier (required) |
| `explain` | string | Human readable description (required) |
| `cmds` | array | List of triggers (keyword, regex, files, etc.) |
| `mode` | string | `ui` (default), `silent` (bg only), `detached` (new window) |
| `route` | string | Frontend route to navigate to (e.g. `/settings`) |
| `icon` | string/obj | Feature-specific icon |
| `mainPush` | boolean | Push input text to search bar |
| `mainHide` | boolean | Hide main window when triggered |

### Command Triggers (`cmds`)
| Type | Fields | Description |
|---|---|---|
| `keyword` | `value` | Exact keyword match |
| `regex` | `match`, `label`, `explain` | Regex match against input |
| `files` | `exts`, `fileType`, `match` | File/Dir drop (`match`=name regex) |
| `img` | `exts` | Image drag & drop |
| `over` | `label`, `exclude`, `minLength` | Text selection from other apps |

## 3. Preload Script (`preload.cjs`)

> **Rules**:
> 1. **Extension**: MUST be `.cjs` (project is ESM).
> 2. **Module System**: MUST use CommonJS (`require`).
> 3. **purpose**: Access Node.js APIs (`fs`, `crypto`, `child_process`) or Electron APIs (`clipboard`, `shell`).
> 4. **Constraint**: Do NOT put UI logic (DOM, Canvas) here.

```javascript
const fs = require('fs');
// const { PDFDocument } = require('pdf-lib'); // npm packages allowed

window.myPluginApi = {
  readFile: (path) => fs.readFileSync(path, 'utf8'),
  // Expose to frontend as: window.myPluginApi.readFile(path)
}
```

## 4. API Reference (TypeScript Definition)

> **R/B** = Available in both Renderer (`window.mulby`) and Backend (`context.api`).
> **R** = Renderer only. **B** = Backend only.

### Core Modules

```typescript
// notification (R/B) - System Notifications
interface Notification {
  show(message: string, type?: 'none'|'info'|'error'|'question'|'warning'): void;
}

// shell (R/B) - System Operations
interface Shell {
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  openFolder(path: string): Promise<string>;
  trashItem(path: string): Promise<void>;
  beep(): void;
}

// filesystem (R/B) - Node.js-link FS Access
interface FileSystem {
  readFile(path: string, encoding?: string): Promise<string | Buffer>;
  writeFile(path: string, data: string | Buffer, encoding?: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean; adjusted: number }>;
  copy(src: string, dest: string): Promise<void>;
  move(src: string, dest: string): Promise<void>;
  // Backend Only Path Utils
  extname?(path: string): string;
  join?(...paths: string[]): string;
  dirname?(path: string): string;
  basename?(path: string, ext?: string): string;
}

// http (R/B) - Network Requests
interface Http {
  request(opts: { url: string; method?: string; headers?: any; body?: any; timeout?: number }): Promise<{ status: number; data: string; headers: any }>;
  get(url: string, headers?: any): Promise<HttpResponse>;
  post(url: string, body?: any, headers?: any): Promise<HttpResponse>;
  put(url: string, body?: any): Promise<HttpResponse>;
  delete(url: string, headers?: any): Promise<HttpResponse>;
}

// clipboard (R/B)
interface Clipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  readImage(): Promise<Buffer | null>;
  writeImage(image: string | Buffer): Promise<void>;
  readFiles(): Promise<{ path: string; name: string; size: number; isDirectory: boolean }[]>;
  writeFiles(paths: string[]): Promise<void>; // R only
  getFormat(): Promise<'text'|'image'|'files'|'html'|'empty'>;
}

// dialog (R/B) - Native Dialogs
interface Dialog {
  showOpenDialog(opts?: { title?: string; defaultPath?: string; buttonLabel?: string; filters?: any[]; properties?: string[] }): Promise<string[]>;
  showSaveDialog(opts?: { title?: string; defaultPath?: string; filters?: any[] }): Promise<string | null>;
  showMessageBox(opts: { type?: string; title?: string; message: string; buttons?: string[] }): Promise<{ response: number }>;
  showErrorBox(title: string, content: string): void;
}

// system (R/B) - System Info
interface System {
  getSystemInfo(): Promise<{ platform: string; arch: string; hostname: string; cpus: number; totalmem: number }>;
  getAppInfo(): Promise<{ name: string; version: string; userDataPath: string }>;
  getPath(name: 'home'|'appData'|'temp'|'desktop'|'downloads'|'documents'|'pictures'|'music'|'videos'): Promise<string>;
  getEnv(name: string): Promise<string>;
  getIdleTime(): Promise<number>;
  getFileIcon(path: string): Promise<string>; // Base64
  getNativeId(): Promise<string>;
  isDev(): Promise<boolean>;
  isMacOS(): Promise<boolean>;
  isWindows(): Promise<boolean>;
  isLinux(): Promise<boolean>;
}

// storage (R/B) - Persistent KV Store
interface Storage {
  get(key: string, namespace?: string): Promise<any>;
  set(key: string, value: any, namespace?: string): Promise<boolean>;
  remove(key: string, namespace?: string): Promise<boolean>;
  clear(): void; // B only
  keys(): string[]; // B only
}
```

### Advanced System Modules

```typescript
// network (R/B)
interface Network {
  isOnline(): Promise<boolean>;
  onOnline(cb: () => void): void; // R only
  onOffline(cb: () => void): void; // R only
}

// power (R/B)
interface Power {
  getSystemIdleTime(): Promise<number>;
  getSystemIdleState(threshold: number): Promise<'active'|'idle'|'locked'|'unknown'>;
  isOnBatteryPower(): Promise<boolean>;
  onSuspend(cb: () => void): void; // R only
  onResume(cb: () => void): void; // R only
  onAC(cb: () => void): void; // R only
  onBattery(cb: () => void): void; // R only
}

// security (R/B) - Encrypted Storage
interface Security {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(plain: string): Promise<Buffer>;
  decryptString(encrypted: Buffer): Promise<string>;
}

// shortcut (R/B) - Global Hotkeys
interface Shortcut {
  register(accelerator: string): Promise<boolean>;
  unregister(accelerator: string): Promise<void>;
  unregisterAll(): Promise<void>;
  isRegistered(accelerator: string): Promise<boolean>;
  onTriggered(cb: (acc: string) => void): void;
}

// geolocation (R)
interface Geolocation {
  getAccessStatus(): Promise<string>;
  requestAccess(): Promise<string>; // macOS only
  canGetPosition(): Promise<boolean>;
  getCurrentPosition(): Promise<{ latitude: number; longitude: number }>;
  openSettings(): Promise<void>;
}

// host (R) - Call Backend from UI
interface Host {
  invoke(pluginId: string, method: string, ...args: any[]): Promise<any>;
  status(pluginId: string): Promise<{ ready: boolean; active: boolean }>;
  restart(pluginId: string): Promise<boolean>;
}
```

### UI & Interaction Modules

```typescript
// window (R) - Window Control
interface Window {
  hide(): void;
  show(): void;
  setSize(w: number, h: number): void;
  setExpendHeight(h: number): void;
  center(): void;
  setAlwaysOnTop(flag: boolean): void;
  detach(): void;
  close(): void;
  create(url: string, opts?: any): Promise<ChildWindowHandle>;
  startDrag(path: string): void;
}

// subInput (R) - Secondary Input Bar
interface SubInput {
  set(placeholder?: string, isFocus?: boolean): void;
  setValue(text: string): void;
  focus(): void;
  blur(): void;
  select(): void;
  remove(): void;
  onChange(cb: (e: { text: string }) => void): void;
}

// plugin (R) - Plugin Management
interface Plugin {
  getAll(): Promise<PluginInfo[]>;
  search(query: string): Promise<PluginSearchResult[]>;
  run(id: string, code: string, input?: any): Promise<void>;
  install(path: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  outPlugin(kill?: boolean): Promise<void>;
  redirect(label: string, payload?: any): Promise<boolean>;
  getReadme(id: string): Promise<string>;
}

// theme (R)
interface Theme {
  get(): Promise<{ mode: string; actual: string }>;
  set(mode: 'light'|'dark'|'system'): Promise<void>;
  onThemeChange(cb: (mode: string) => void): void;
}

// menu (R) - Context Menu
interface Menu {
  showContextMenu(items: { label: string; id?: string; type?: string; submenu?: any[] }[]): Promise<string | null>;
}

// tray (R/B)
interface Tray {
  create(opts: { icon: string; tooltip?: string; title?: string }): Promise<boolean>;
  destroy(): Promise<void>;
  setIcon(icon: string): Promise<void>;
  setTooltip(tip: string): Promise<void>;
  setTitle(title: string): Promise<void>;
}

// tts (R) - Text to Speech
interface Tts {
  speak(text: string, opts?: { lang?: string; rate?: number }): Promise<void>;
  stop(): void;
  getVoices(): Promise<any[]>;
}

// features (B) - Dynamic Features
interface Features {
  getFeatures(codes?: string[]): DynamicFeature[];
  setFeature(feature: { code: string; cmds: any[]; mode?: string }): void;
  removeFeature(code: string): boolean;
}
```

### Media, Screen & Automation

```typescript
// screen (R/B)
interface Screen {
  getAllDisplays(): Promise<any[]>;
  getPrimaryDisplay(): Promise<any>;
  getCursorScreenPoint(): Promise<{ x: number; y: number }>;
  capture(opts?: { sourceId?: string; format?: 'png'|'jpeg' }): Promise<Buffer>;
  captureRegion(rect: { x: number; y: number; w: number; h: number }, opts?: any): Promise<Buffer>;
  screenCapture(): Promise<string>; // R only, Interactive
  colorPick(): Promise<{ hex: string }>; // R only
  getSources(opts?: { types: string[] }): Promise<any[]>;
}

// input (R/B) - Simulate Input
interface Input {
  hideMainWindowPasteText(text: string): Promise<boolean>;
  hideMainWindowPasteImage(img: string|Buffer): Promise<boolean>;
  hideMainWindowPasteFile(path: string|string[]): Promise<boolean>;
  hideMainWindowTypeString(text: string): Promise<boolean>;
  simulateKeyboardTap(key: string, ...modifiers: string[]): Promise<boolean>;
  simulateMouseMove(x: number, y: number): Promise<boolean>;
  simulateMouseClick(x: number, y: number): Promise<boolean>;
}

// media (R/B) - Permission
interface MediaPerm {
  getAccessStatus(type: 'microphone'|'camera'): Promise<string>;
  askForAccess(type: 'microphone'|'camera'): Promise<boolean>;
}

// sharp (R) - Image Processing
interface Sharp { (input: string|Buffer): SharpInstance; }

// ffmpeg (R) - Video Processing
interface FFmpeg { 
  run(args: string[], onProgress?: (p: any) => void): { promise: Promise<void>; kill: () => void }; 
  isAvailable(): Promise<boolean>;
  download(cb?: (p: any) => void): Promise<{ success: boolean }>;
}

// inbrowser (R) - Browser Automation
interface InBrowser {
  goto(url: string): this;
  click(sel: string): this;
  type(sel: string, text: string): this;
  wait(msOrSel: number|string): this;
  evaluate<T>(fn: () => T): Promise<T>;
  screenshot(): Promise<Buffer>;
  run(): Promise<any[]>;
}
```
