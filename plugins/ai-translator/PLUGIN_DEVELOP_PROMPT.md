# Mulby Plugin Development Guide

> **Architecture**: Mulby is built on the **Electron** framework. Plugins run in a multi-process environment.
> **Contexts**: `UI` = **Renderer Process** (`window.mulby.{module}`), `Main` = **Main Process** (`context.api.{module}`). Most APIs are available in both contexts (marked as **R/B**).

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

// ai (R/B) - AI (tools only in backend)
interface Ai {
  call(option: AiOption, onChunk?: (chunk: AiMessage) => void): AiPromiseLike<AiMessage>;
  allModels(): Promise<AiModel[]>;
  abort(requestId: string): Promise<void>;
  skills: {
    // Available in both Renderer and Backend
    listEnabled(): Promise<AiSkillRecord[]>;
    // Backend name; Renderer uses preview(...)
    previewForCall?(input: { option?: Partial<AiOption>; skillIds?: string[]; prompt?: string }): Promise<AiSkillPreview>;
    // Renderer-only manager
    list?(): Promise<AiSkillRecord[]>;
    refresh?(): Promise<AiSkillRecord[]>;
    get?(skillId: string): Promise<AiSkillRecord | null>;
    listCreateModels?(): Promise<AiSkillCreateModelOption[]>;
    createWithAi?(input: AiSkillCreateWithAiInput): Promise<AiSkillCreateWithAiResult>;
    createWithAiStream?(
      input: AiSkillCreateWithAiInput,
      onChunk: (chunk: AiSkillCreateProgressChunk) => void
    ): AiPromiseLike<AiSkillCreateWithAiResult>;
    create?(input: {
      id?: string;
      name: string;
      description?: string;
      promptTemplate?: string;
      tags?: string[];
      triggerPhrases?: string[];
      mode?: 'manual' | 'auto' | 'both';
      capabilities?: string[];
      internalTools?: string[];
      enabled?: boolean;
      trustLevel?: AiSkillTrustLevel;
      mcpPolicy?: AiSkillMcpPolicy;
    }): Promise<AiSkillRecord>;
    install?(input: {
      source: 'local-dir' | 'zip';
      ref: string;
      trustLevel?: AiSkillTrustLevel;
      enabled?: boolean;
    }): Promise<AiSkillRecord[]>;
    importFromJson?(input: {
      json: string;
      trustLevel?: AiSkillTrustLevel;
      enabled?: boolean;
    }): Promise<AiSkillRecord[]>;
    update?(skillId: string, patch: Partial<AiSkillRecord>): Promise<AiSkillRecord>;
    remove?(skillId: string): Promise<void>;
    enable?(skillId: string): Promise<AiSkillRecord>;
    disable?(skillId: string): Promise<AiSkillRecord>;
    preview?(input: { option?: Partial<AiOption>; skillIds?: string[]; prompt?: string }): Promise<AiSkillPreview>;
    resolve?(option: AiOption): Promise<AiSkillResolveResult>;
  };
  tokens: {
    estimate(input: { model?: string; messages: AiMessage[]; outputText?: string }): Promise<{ inputTokens: number; outputTokens: number }>;
  };
  attachments: {
    upload(input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }): Promise<AiAttachmentRef>;
    get(attachmentId: string): Promise<AiAttachmentRef | null>;
    delete(attachmentId: string): Promise<void>;
    uploadToProvider(input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }): Promise<{ providerId: string; fileId: string; uri?: string }>;
  };
  images: {
    generate(input: { model: string; prompt: string; size?: string; count?: number }): Promise<{ images: string[]; tokens: AiTokenBreakdown }>;
    generateStream(
      input: { model: string; prompt: string; size?: string; count?: number },
      onChunk: (chunk: AiImageGenerateProgressChunk) => void
    ): AiPromiseLike<{ images: string[]; tokens: AiTokenBreakdown }>;
    edit(input: { model: string; imageAttachmentId: string; prompt: string }): Promise<{ images: string[]; tokens: AiTokenBreakdown }>;
  };
  // Renderer-only helpers
  models?: {
    fetch(input: { providerId: string; baseURL?: string; apiKey?: string }): Promise<{ models: AiModel[]; message?: string }>;
  };
  testConnection?: (input?: { providerId?: string; model?: string; baseURL?: string; apiKey?: string }) => Promise<{ success: boolean; message?: string }>;
  testConnectionStream?: (
    input: { providerId?: string; model?: string; baseURL?: string; apiKey?: string },
    onChunk: (chunk: { type: 'reasoning' | 'content'; text: string }) => void
  ) => AiPromiseLike<{ success: boolean; message?: string; reasoning?: string }>;
  settings?: {
    get(): Promise<AiSettings>;
    update(next: Partial<AiSettings>): Promise<AiSettings>;
  };
  // Renderer-only MCP manager (window.mulby.ai.mcp)
  // Backend context.api.ai currently does not expose mcp.*
  mcp?: {
    listServers(): Promise<AiMcpServer[]>;
    getServer(serverId: string): Promise<AiMcpServer | null>;
    upsertServer(server: AiMcpServer): Promise<AiMcpServer>;
    removeServer(serverId: string): Promise<void>;
    activateServer(serverId: string): Promise<AiMcpServer>;
    deactivateServer(serverId: string): Promise<AiMcpServer>;
    restartServer(serverId: string): Promise<AiMcpServer>;
    checkServer(serverId: string): Promise<{ ok: boolean; message?: string }>;
    listTools(serverId: string): Promise<AiMcpTool[]>;
    abort(callId: string): Promise<boolean>;
    getLogs(serverId: string): Promise<AiMcpServerLogEntry[]>;
  };
}

type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content?: string | AiMessageContent[];
  reasoning_content?: string;
  chunkType?: 'meta' | 'text' | 'reasoning' | 'tool-call' | 'tool-result' | 'error' | 'end';
  capability_debug?: {
    requested: string[];
    allowed: string[];
    denied: string[];
    reasons: string[];
    selectedSkills?: { id: string; source: AiSkillSource; trustLevel: AiSkillTrustLevel }[];
  };
  policy_debug?: {
    skills: {
      requested?: AiSkillSelection;
      selectedSkillIds: string[];
      selectedSkillNames: string[];
      reasons: string[];
    };
    mcp: { requested?: AiMcpSelection; resolved?: AiMcpSelection };
    toolContext: { requested?: AiToolContext; resolved?: AiToolContext };
    capabilities: { requested: string[]; resolved: string[] };
    internalTools: { requested: string[]; resolved: string[] };
  };
  tool_call?: { id: string; name: string; args?: unknown };
  tool_result?: { id: string; name: string; result?: unknown };
  error?: { message: string; code?: string; category?: string; retryable?: boolean; statusCode?: number };
  usage?: AiTokenBreakdown;
};
type AiMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentId: string; mimeType?: string }
  | { type: 'file'; attachmentId: string; mimeType?: string; filename?: string };
type AiOption = {
  model?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  capabilities?: string[];
  internalTools?: string[]; // deprecated: prefer capabilities
  toolingPolicy?: {
    enableInternalTools?: boolean;
    capabilityAllowList?: string[];
    capabilityDenyList?: string[];
  };
  mcp?: AiMcpSelection;
  skills?: AiSkillSelection;
  params?: AiModelParameters;
  toolContext?: AiToolContext;
  maxToolSteps?: number; // default 20, max 100
};
type AiTool = {
  type: 'function';
  function?: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    required?: string[];
  };
};
type AiModelParameters = {
  contextWindow?: number;
  temperatureEnabled?: boolean;
  topPEnabled?: boolean;
  maxOutputTokensEnabled?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;
};
type AiEndpointType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'image-generation'
  | 'jina-rerank';
type AiModel = {
  id: string;
  label: string;
  description: string;
  icon?: string;
  providerRef?: string;
  providerLabel?: string;
  endpointType?: AiEndpointType;
  supportedEndpointTypes?: AiEndpointType[];
  params?: AiModelParameters;
  capabilities?: Array<{
    type: 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank';
    isUserSelected?: boolean;
  }>;
};
type AiSettings = {
  providers: AiProviderConfig[];
  models?: AiModel[];
  defaultModel?: string;
  defaultParams?: AiModelParameters;
  mcp?: AiMcpSettings;
  skills?: AiSkillSettings;
};
type AiProviderConfig = {
  id: string;
  type?: string;
  label?: string;
  enabled: boolean;
  apiKey?: string;
  baseURL?: string;
  apiVersion?: string;
  anthropicBaseURL?: string;
  headers?: Record<string, string>;
  defaultModel?: string;
  defaultParams?: AiModelParameters;
};
type AiMcpSelection = { mode?: 'off' | 'manual' | 'auto'; serverIds?: string[]; allowedToolIds?: string[] };
type AiToolContext = {
  pluginName?: string;
  internalTag?: string;
  mcpScope?: { allowedServerIds?: string[]; allowedToolIds?: string[] };
};
type AiMcpServer = {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'streamableHttp';
  isActive: boolean;
  description?: string;
  baseUrl?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  timeoutSec?: number;
  longRunning?: boolean;
  disabledTools?: string[];
  disabledAutoApproveTools?: string[];
  installSource?: 'manual' | 'protocol' | 'builtin';
  isTrusted?: boolean;
  trustedAt?: number;
  installedAt?: number;
};
type AiMcpSettings = {
  servers: AiMcpServer[];
  defaults?: { timeoutMs?: number; longRunningMaxMs?: number; approvalMode?: 'always' | 'auto-approved-only' | 'never' };
};
type AiMcpTool = {
  id: string;
  name: string;
  description?: string;
  serverId: string;
  serverName: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};
type AiMcpServerLogEntry = {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  data?: unknown;
};
type AiSkillSource = 'manual' | 'local-dir' | 'zip' | 'json' | 'builtin' | 'system';
type AiSkillTrustLevel = 'untrusted' | 'reviewed' | 'trusted';
type AiSkillMcpPolicy = {
  serverIds?: string[];
  allowedToolIds?: string[];
  blockedToolIds?: string[];
};
type AiSkillSelection = {
  mode?: 'off' | 'manual' | 'auto';
  skillIds?: string[];
  variables?: Record<string, string>;
};
type AiSkillRecord = {
  id: string;
  source: AiSkillSource;
  origin?: 'system' | 'app';
  readonly?: boolean;
  sourceRef?: string;
  installPath?: string;
  skillMdPath?: string;
  contentHash: string;
  enabled: boolean;
  trustLevel: AiSkillTrustLevel;
  installedAt: number;
  updatedAt: number;
  descriptor: {
    id: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    tags?: string[];
    triggerPhrases?: string[];
    mode?: 'manual' | 'auto' | 'both';
    promptTemplate?: string;
    mcpPolicy?: AiSkillMcpPolicy;
    capabilities?: string[];
    internalTools?: string[];
  };
};
type AiSkillSettings = {
  enabled: boolean;
  activeSkillIds: string[];
  autoSelect?: { enabled?: boolean; maxSkillsPerCall?: number; minScore?: number };
  records: AiSkillRecord[];
};
type AiSkillPreview = {
  selected: AiSkillRecord[];
  systemPrompt: string;
  mcpImpact: { serverIds?: string[]; allowedToolIds?: string[]; blockedToolIds?: string[] };
  reasons: string[];
};
type AiSkillResolveResult = {
  selectedSkillIds: string[];
  selectedSkillNames: string[];
  selectedSkills?: Array<{ id: string; source: AiSkillSource; trustLevel: AiSkillTrustLevel }>;
  systemPrompts: string[];
  mergedMcp?: AiMcpSelection;
  toolContextPatch?: AiToolContext['mcpScope'];
  capabilities?: string[];
  internalTools?: string[];
  reasons?: string[];
};
type AiSkillCreateModelOption = {
  id: string;
  label: string;
  providerRef?: string;
  providerLabel?: string;
};
type AiSkillCreateWithAiInput = {
  requirements: string;
  model: string;
  previousRawText?: string;
  replaceSkillId?: string;
  enabled?: boolean;
  trustLevel?: AiSkillTrustLevel;
  modePreference?: 'manual' | 'auto' | 'both';
};
type AiSkillCreateWithAiResult = {
  record: AiSkillRecord;
  generation: { model: string; rawText: string; notes?: string[] };
};
type AiSkillCreateProgressChunk = {
  type: 'status' | 'content' | 'reasoning';
  text: string;
  stage?: 'generating' | 'parsing' | 'validating' | 'writing' | 'completed';
  stageStatus?: 'start' | 'done' | 'error';
};
type AiAttachmentRef = { attachmentId: string; mimeType: string; size: number; filename?: string; expiresAt?: string; purpose?: string };
type AiTokenBreakdown = { inputTokens: number; outputTokens: number };
type AiImageGenerateProgressChunk = {
  type: 'status' | 'preview';
  stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback';
  message?: string;
  image?: string;
  index?: number;
  received?: number;
  total?: number;
};
type AiPromiseLike<T> = Promise<T> & { abort: () => void };

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

// messaging (R/B) - Plugin-to-Plugin Communication
interface Messaging {
  send(targetPluginId: string, type: string, payload: unknown): Promise<void>;
  broadcast(type: string, payload: unknown): Promise<void>;
  on(handler: (message: { id: string; from: string; to?: string; type: string; payload: unknown; timestamp: number }) => void | Promise<void>): void;
  off(handler?: (message: any) => void): void;
}

// scheduler (B) - Task Scheduler
interface Scheduler {
  schedule(task: TaskInput): Promise<Task>;
  cancel(taskId: string): Promise<void>;
  pause(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
  get(taskId: string): Promise<Task | null>;
  list(filter?: { status?: string; type?: string; limit?: number }): Promise<Task[]>;
  getExecutions(taskId: string, limit?: number): Promise<TaskExecution[]>;
  validateCron(expression: string): boolean;
  getNextCronTime(expression: string, after?: Date): Date;
  describeCron(expression: string): string;
}

interface TaskInput {
  name: string;
  type: 'once' | 'repeat' | 'delay';
  callback: string;
  description?: string;
  payload?: any;
  time?: number;           // For 'once' type
  cron?: string;           // For 'repeat' type (6-field: sec min hour day month weekday)
  delay?: number;          // For 'delay' type
  timezone?: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  endTime?: number;        // For 'repeat' type
  maxExecutions?: number;  // For 'repeat' type
}

interface Task extends TaskInput {
  id: string;
  pluginId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  nextRunTime?: number;
  lastRunTime?: number;
  executionCount: number;
  failureCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

interface TaskExecution {
  id: string;
  taskId: string;
  startTime: number;
  endTime?: number;
  status: 'success' | 'failed' | 'timeout';
  result?: any;
  error?: string;
  duration?: number;
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
  // Call main process API (e.g., clipboard.readText)
  invoke(pluginId: string, method: string, ...args: any[]): Promise<any>;
  // Call plugin custom methods (exported in main.ts)
  call(pluginId: string, method: string, ...args: any[]): Promise<{ data: any }>;
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
  enable(name: string): Promise<{ success: boolean; error?: string }>;
  disable(name: string): Promise<{ success: boolean; error?: string }>;
  uninstall(id: string): Promise<void>;
  outPlugin(kill?: boolean): Promise<void>;
  redirect(label: string, payload?: any): Promise<boolean>;
  getReadme(id: string): Promise<string>;
  
  // Background & Process Management
  listBackground(): Promise<any[]>;
  startBackground(pluginId: string): Promise<{ success: boolean; error?: string }>;
  stopBackground(pluginId: string): Promise<{ success: boolean }>;
  getBackgroundInfo(pluginId: string): Promise<any>;
  stopPlugin(pluginId: string): Promise<void>;
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
  restoreWindows(): Promise<boolean>; // Restore hidden windows after input
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
  // Navigation & Window
  goto(url: string, headers?: Record<string, string>, timeout?: number): this;
  useragent(ua: string): this;
  device(nameOrOption: string | { userAgent: string; size: { width: number; height: number } }): this;
  viewport(width: number, height: number): this;
  show(): this;
  hide(): this;
  devTools(mode?: 'right' | 'bottom' | 'undocked' | 'detach'): this;

  // Interaction
  click(selector: string | number, mouseButtonOrY?: string | number, mouseButton?: string): this;
  mousedown(selector: string | number, mouseButtonOrY?: string | number, mouseButton?: string): this;
  mouseup(selector: string | number, mouseButtonOrY?: string | number, mouseButton?: string): this;
  dblclick(selector: string | number, mouseButtonOrY?: string | number, mouseButton?: string): this;
  hover(selector: string | number, y?: number): this;
  type(selector: string, text: string): this;
  input(selectorOrText: string, text?: string): this;
  press(key: string, modifiers?: string[]): this;
  focus(selector: string): this;
  scroll(selectorOrY: string | number, optionalOrY?: any): this;
  paste(text: string): this;
  file(selector: string, payload: string | string[] | Buffer): this;
  drop(selectorOrX: string | number, optionalYOrPayload: any, payload?: any): this;

  // Content & State
  value(selector: string, val: string): this;
  check(selector: string, checked: boolean): this;
  css(cssText: string): this;
  cookies(nameOrFilter?: string | any): this;
  setCookies(nameOrCookies: string | any[], value?: string): this;
  removeCookies(name: string): this;
  clearCookies(url?: string): this;

  // Flow Control
  wait(msOrSelectorOrFunc: number | string | Function, ...params: any[]): this;
  when(selectorOrFunc: string | Function, ...params: any[]): this;
  end(): this;

  // Output Data (In run() result)
  evaluate<T>(func: string | Function, ...params: any[]): this;
  screenshot(target?: string | object, savePath?: string): this;
  pdf(options?: any, savePath?: string): this;
  markdown(selector?: string): this;
  download(urlOrFunc: string | Function, savePath?: string, ...params: any[]): this;

  // Execution
  run(): Promise<any[]>;

  // Management
  getIdleInBrowsers(): Promise<any[]>;
  setInBrowserProxy(config: any): Promise<boolean>;
  clearInBrowserCache(): Promise<boolean>;
}
```

## 5. Background Plugin Development

Enable plugins to run in the background (e.g., for cron jobs, monitoring).

### 5.1 Configuration (`manifest.json`)

Explicitly enable background mode:

```json
{
  "pluginSetting": {
    "background": true,         // Enable background mode
    "persistent": true,         // Auto-restore on app restart
    "maxRuntime": 0             // Max runtime in ms (0 = unlimited)
  }
}
```

### 5.2 Lifecycle Hooks (`src/main.ts`)

Handle background transitions:

```typescript
export function onBackground() {
  // Triggered when window closes (if background: true)
  console.log('Moved to background');
  // Start background tasks (e.g., cron jobs)
}

export function onForeground() {
  // Triggered when window re-opens
  console.log('Back to foreground');
  // Optional: Update UI or optimize resources
}

// Standard hooks
export function onLoad() { /* Init */ }
export function onUnload() { /* Cleanup (Called on app exit or manual stop) */ }
```

### 5.3 Management API

- **Check Status**: `api.plugin.listBackground()`
- **Stop**: `api.plugin.stopBackground(pluginId)`
- **Start**: `api.plugin.startBackground(pluginId)`

### 5.4 UI Plugin Integration

For plugins with UI (`"ui": "..."` in manifest):
1. Background logic MUST go in **backend** (`src/main.ts`).
2. **Frontend** (`src/ui/...`) stops when window closes.
3. Use IPC (via `api.messaging` or `host` module) to communicate between active UI and background backend.

## 6. Task Scheduler (Backend Only)

Schedule tasks to run at specific times or intervals. Tasks persist across app restarts.

### 6.1 Creating Tasks

```typescript
// One-time: Execute at timestamp
await api.scheduler.schedule({
  name: 'Meeting Reminder',
  type: 'once',
  time: Date.now() + 3600000,  // 1 hour later
  callback: 'onReminder',
  payload: { message: 'Meeting starts soon' }
});

// Repeat: Execute via Cron (6-field: sec min hour day month weekday)
await api.scheduler.schedule({
  name: 'Daily Backup',
  type: 'repeat',
  cron: '0 0 2 * * *',  // Daily at 2 AM
  callback: 'onBackup'
});

// Delay: Execute after milliseconds
await api.scheduler.schedule({
  name: 'Delayed Task',
  type: 'delay',
  delay: 5000,  // 5 seconds
  callback: 'onTask'
});
```

### 6.2 Task Callbacks

Export callback functions in `src/main.ts`:

```typescript
export async function onReminder({ api, payload, task }) {
  api.notification.show(payload.message);
  // Return value is logged in execution history
  return { success: true };
}

export async function onBackup({ api }) {
  try {
    await api.filesystem.copy('/source', '/backup');
    return { files: 100 };
  } catch (error) {
    throw error;  // Triggers retry if maxRetries configured
  }
}
```

### 6.3 Managing Tasks

```typescript
// List tasks (current plugin only)
const tasks = await api.scheduler.list();
const pending = await api.scheduler.list({ status: 'pending' });

// Pagination
const page1 = await api.scheduler.list({ limit: 20, offset: 0 });
const totalCount = await api.scheduler.count({ status: 'pending' });

// Control tasks
await api.scheduler.pause(taskId);
await api.scheduler.resume(taskId);
await api.scheduler.cancel(taskId);

// Batch operations
await api.scheduler.deleteTasks([taskId1, taskId2, taskId3]);

// Cleanup old tasks (completed/failed/cancelled)
await api.scheduler.cleanup();  // Default: 7 days ago
await api.scheduler.cleanup(Date.now() - 30 * 24 * 60 * 60 * 1000);  // 30 days

// Query
const task = await api.scheduler.get(taskId);
const history = await api.scheduler.getExecutions(taskId, 10);
```

### 6.4 Advanced Options

```typescript
await api.scheduler.schedule({
  name: 'Robust Task',
  type: 'once',
  time: Date.now() + 1000,
  callback: 'onTask',
  maxRetries: 3,        // Retry on failure
  retryDelay: 30000,    // Wait 30s between retries
  timeout: 60000,       // Kill after 60s
  payload: { data: 'important' }
});

// Repeat with limits
await api.scheduler.schedule({
  name: 'Limited Repeat',
  type: 'repeat',
  cron: '0 0 * * * *',
  callback: 'onTask',
  endTime: Date.now() + 86400000,  // Stop after 24h
  maxExecutions: 100                // Or after 100 runs
});
```

### 6.5 Cron Helpers

```typescript
// Validate expression
api.scheduler.validateCron('0 0 2 * * *');  // true

// Get next run time
api.scheduler.getNextCronTime('0 0 2 * * *');  // Date object

// Human-readable description
api.scheduler.describeCron('0 0 2 * * *');  // "每天凌晨2点"
```

**Common Cron Examples**:
- `'0 * * * * *'` - Every minute
- `'0 0 * * * *'` - Every hour
- `'0 0 2 * * *'` - Daily at 2 AM
- `'0 0 9 * * 1-5'` - Weekdays at 9 AM
- `'0 */30 * * * *'` - Every 30 minutes

## 7. Host API - UI 调用后端方法

Host API 允许插件 UI 调用后端（main.ts）中导出的自定义方法。

### 7.1 后端导出方法

支持三种导出方式（按优先级查找）：

```typescript
// 方式1：直接导出函数
export async function quickAction(context: PluginContext, text: string) {
  context.api.notification.show(`处理: ${text}`)
  return { success: true }
}

// 方式2：host 对象（推荐）
export const host = {
  async processData(context: PluginContext, data: any) {
    const { notification, storage } = context.api
    notification.show('处理中...')
    await storage.set('lastResult', data)
    return { processed: true, result: data }
  }
}

// 方式3：api/methods 等对象
export const api = {
  async customMethod(context: PluginContext, params: any) {
    return { success: true, received: params }
  }
}
```

**注意**：所有方法的第一个参数必须是 `context`，包含 `context.api`。

### 7.2 UI 中调用

```typescript
import { useMulby } from './hooks/useMulby'

export default function App() {
  const { host, notification } = useMulby('my-plugin')

  const handleClick = async () => {
    try {
      // 调用后端方法
      const result = await host.call('processData', { value: 123 })
      console.log(result.data) // { processed: true, result: {...} }
      notification.show('成功')
    } catch (err) {
      notification.show(`错误: ${err.message}`, 'error')
    }
  }

  return <button onClick={handleClick}>处理数据</button>
}
```

### 7.3 与 host.invoke 的区别

- **host.call(method, ...args)** - 调用插件自定义方法（main.ts 中导出的）
- **host.invoke(method, ...args)** - 调用主进程 API（如 clipboard.readText）
