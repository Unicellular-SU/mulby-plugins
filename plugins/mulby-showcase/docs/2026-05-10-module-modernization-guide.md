# Mulby Showcase Module Modernization Guide

This guide summarizes the System Info module migration and should be used when modernizing the remaining showcase modules.

## Scope Rules

- Showcase pages demonstrate plugin-usable APIs only.
- Do not add examples for host-only APIs, host settings pages, system page APIs, system plugin APIs, super panel APIs, plugin manager actions, or other APIs intended for Mulby itself.
- Keep module behavior focused on the page's domain. Move API reference material out of the main functional area and into the shared right-side API panel.
- Use `lucide-react` icons only. Do not introduce emoji icons in code, docs tables, status labels, buttons, empty states, or examples.

## Migration Workflow

1. Inspect the module's current calls.
   - Start from `src/ui/modules/<ModuleName>/index.tsx`.
   - List every `useMulby()` namespace and method used by the page.
   - Search for old API names, duplicated examples, raw-data cards, and direct host-only calls.

2. Check current host documentation and types.
   - Prefer `D:\Node.js\mulby\docs\apis`.
   - Read the relevant API docs directly, for example `clipboard.md` plus `clipboard-history.md` for the Clipboard module.
   - Cross-check against `src/types/mulby.d.ts` and `src/ui/hooks/useMulby.ts`.
   - If docs and local types disagree, trust the current plugin type definitions and the actual host implementation in the workspace.

3. Update the plugin contract.
   - Add required `manifest.permissions` entries before calling permission-gated APIs.
   - Keep feature codes and trigger commands intentional.
   - Do not add permissions just because an API exists; add only what the module actually calls.

4. Refresh the functional UI.
   - Keep main page content for interactive demos and live results.
   - Add newly supported plugin-facing APIs that belong to the module.
   - Remove stale API examples from main cards.
   - Keep destructive actions explicit and scoped. Prefer refresh/delete buttons near the data they affect.

5. Add the right-side API panel.
   - Use `ApiReferencePanel` from `src/ui/components`.
   - Provide `apiGroups` with only methods actually used by the page.
   - Provide concise `apiExamples` that match the current docs and current code.
   - Provide `rawData` for the page state and API responses.
   - Redact large or sensitive fields in `rawData`, such as data URLs, binary buffers, full image content, and very long text.

6. Preserve build quality.
   - Remove unused imports after icon and API cleanup.
   - Avoid JSX text containing raw `>` characters; use words, slashes, or escaped text.
   - Keep `strict` TypeScript happy instead of weakening types.

## Right-Side API Panel Pattern

Each migrated page should follow this shape:

```tsx
import { ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'

const apiGroups: ApiReferenceGroup[] = [
  {
    title: 'Clipboard API',
    items: [
      { name: 'clipboard.readText()', description: 'Read plain text from the clipboard.' },
    ],
  },
]

const apiExamples: ApiExample[] = [
  {
    title: 'Read clipboard text',
    code: `const text = await window.mulby.clipboard.readText()`,
  },
]

const rawData = {
  currentFormat,
  textContent,
}

return (
  <div className="page-with-api-panel">
    <div className="page-content">{/* functional UI */}</div>
    <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
  </div>
)
```

## Main Content Rules

- Do not keep `Card title="使用的 API"`, `Card title="API 参考"`, or `Card title="原始数据"` in the main content after the panel is added.
- Main cards should be task-oriented: status, controls, live previews, history lists, and result views.
- If a page needs debug details, put them in `rawData`.
- If a data field is too large for the UI, show a summary in the main page and put a redacted/summarized version in the panel.

## Permission-Gated API Rules

- Check API docs for required manifest permissions before adding a call.
- Add only the needed permission to `manifest.json`.
- Show permission state or failure feedback in the module when the API can be denied.
- Examples:
  - `geolocation.getCurrentPosition()` requires `permissions.geolocation`.
  - Clipboard history APIs should be checked against `clipboard-history.md` before use.

## Verification Checklist

Run these before finishing each module:

```powershell
npm run build
git diff --check
rg -n -P "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" src\ui
```

Manual review:

- Open the module and verify the main workflow still works.
- Expand and collapse the right-side API panel.
- Confirm the API list includes used APIs and excludes host-only APIs.
- Confirm API examples match the latest docs.
- Confirm raw data is useful and redacted where needed.
- Confirm there are no emoji icons and no old API example cards in the main content.

## System Info Module Lessons

- Existing calls can remain when current docs still support them.
- New APIs should be added only when they belong to the module and are plugin-facing.
- Manifest updates are part of API migration; `geolocation` needed an explicit permission.
- Raw data should omit large Data URL content while preserving enough shape for debugging.
- A reusable panel component reduces repeated work for later modules.

## Clipboard Module Lessons

- `clipboard.md` and `clipboard-history.md` both require `permissions.clipboard`.
- When a documented renderer API is missing from the local plugin type definitions, update `src/types/mulby.d.ts` to match the host docs before using it.
- If a plugin-facing API is documented for both renderer and backend but the renderer path returns no data or behaves inconsistently, compare with a working plugin and prefer a backend `rpc` bridge:
  - expose `export const rpc = { methodName() { return mulby.namespace.method() } }` in `src/main.ts`;
  - call it from UI with `useMulby('<manifest.id>').host.call('methodName', ...args)`;
  - use `manifest.id` for scoped plugin ids such as `@mulby/showcase`, because host processes are keyed by plugin id.
- For clipboard history, use backend `mulby.clipboardHistory` through `host.call` in showcase. The current host preload does not expose `window.mulby.clipboardHistory`, while the backend worker exposes `mulby.clipboardHistory` and the standalone clipboard history plugin uses the same route.
- Clipboard history belongs in the main workflow, not only the API panel, because it is a user-facing management feature.
- Keep destructive history actions explicit. `clipboardHistory.clear()` clears non-favorite records, so label it as clearing non-favorites rather than all records.
- Redact image history content and Data URLs in `rawData`; show image previews in the main UI only when they are useful.
- Prefer using `useMulby()` namespaces such as `dialog` instead of direct `window.mulby.*` calls inside modules.

## Input Module Lessons

- `input.md` currently supports paste text, paste image, paste file, type string, restore windows, keyboard tap, and mouse move/click/double-click/right-click.
- Include `input.restoreWindows()` as a real action when the page demonstrates continuous input flows. It is part of the current API and prevents hidden-window state from lingering after scripts.
- Keep `inputMonitor` separate from the basic input-control page unless the module explicitly demonstrates global input listening. It requires `permissions.inputMonitor` and may also require `permissions.accessibility`, so adding it changes the plugin's privacy/permission surface.
- If the page calls `permission.isAccessibilityTrusted()` or `permission.openSystemSettings('accessibility')`, add `permissions.accessibility` to `manifest.json`; those permission APIs are gated by the same manifest permission.
- Use `screen.getCursorScreenPoint()` as a related API for mouse-coordinate demos, but keep it in the related API group rather than treating it as an input method.
- Run a TypeScript check or targeted symbol scan after cleaning imports. Vite/esbuild can build while still leaving unresolved JSX identifiers in TSX.

## File Manager Module Lessons

- The file page should cover plugin-facing `filesystem`, `dialog`, basic `shell`, and `desktop` search APIs together. Do not include `shell.runCommand`, command policy, or command audit management in this module unless a later task explicitly adds the permission and a risk-aware workflow.
- `filesystem.exists`, `stat`, `readFile`, `writeFile`, `readdir`, `mkdir`, `copy`, `move`, and `unlink` are available to renderer plugins. Backend-only path helpers such as `join`, `dirname`, `basename`, and `extname` should not be shown on the renderer page unless the page actually bridges to backend RPC.
- Keep permanent deletion scoped to files created by the demo. For user-selected files, prefer `shell.trashItem()` with a confirmation dialog because it is reversible through the OS trash/recycle-bin flow.
- `shell.openPath()` and `shell.openFolder()` return an error string on failure and an empty string on success, so page code should check the returned string instead of assuming the promise resolving means the action succeeded.
- Desktop file and app search is a renderer-facing API (`window.mulby.desktop`). Search results can be previewed with `filesystem` calls and opened or revealed with basic `shell` APIs.
- Raw data for file pages should include path, stat, directory entries, search results, dialog returns, and operation logs, but large file contents and long directory listings must be truncated.

## Network Module Lessons

- `http.request()` supports `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, and `HEAD`; shortcut methods currently cover `get`, `post`, `put`, and `delete`.
- `http.request()` rejects on timeout or connection errors, but HTTP error statuses are still normal responses. The UI should show status codes instead of treating every non-2xx status as a thrown error.
- Validate JSON request headers before sending. If the page stores raw request state in the API panel, redact sensitive header values such as authorization, cookies, tokens, and API keys.
- Build response previews as a single string before passing them to `CodeBlock`; adjacent JSX expressions create `string[]` children and break strict TypeScript checks.
- `network.onOnline()` and `network.onOffline()` are renderer-only event helpers. The page can record event callbacks, while backend examples should only use `network.isOnline()`.
- Do not add host settings, proxy configuration, update-center, plugin-store, or command-runner network examples to this page; keep it focused on plugin-facing HTTP and online status APIs.

## Screen Module Lessons

- Capture APIs require `permissions.screen`: `getSources`, `getWindowBounds`, `capture`, `captureRegion`, `getMediaStreamConstraints`, `screenCapture`, and `colorPick`. Add only this permission for screen capture; camera capture belongs in the Media module.
- `manifest.features[].preCapture` is plugin-facing and useful for screenshot workflows. When enabled, read image attachments from `onPluginInit()` and handle missing `capture.region` gracefully because platform implementations can return only an image.
- Cover newer screen APIs in the same module: `getWindowBounds`, `captureRegion`, `getMediaStreamConstraints`, `screenToDipPoint`, `dipToScreenPoint`, `screenToDipRect`, and `dipToScreenRect`.
- `getMediaStreamConstraints({ audio: true })` needs `permissions.screen` plus `permissions.microphone`. If the screen page demonstrates audio recording constraints or calls `permission.*('microphone')`, declare `permissions.microphone`, show microphone permission state, and keep camera permission in Media.
- Permission API calls are gated by the manifest before the system prompt runs. Missing entries fail immediately with `Plugin "<pluginId>" lacks manifest.permissions.<permission>`, so `permission.request('microphone')` must never be added without the matching `manifest.permissions.microphone`.
- Avoid routing from the screen page into unrelated plugins or host pages. Color picking should demonstrate `screen.colorPick()` and clipboard copy only, not plugin orchestration.
- Raw data should summarize thumbnails and screenshots instead of storing full Data URLs. Include capture metadata, selected source IDs, bounds, generated media constraints, coordinate conversions, and operation logs.

## Media Module Lessons

- Media API currently manages camera and microphone permissions only: `media.getAccessStatus`, `media.askForAccess`, `media.hasCameraAccess`, and `media.hasMicrophoneAccess`.
- Declare `permissions.camera` before calling camera media APIs or `permission.*('camera')`; declare `permissions.microphone` before calling microphone media APIs, `permission.*('microphone')`, `getUserMedia({ audio: true })`, or `MediaRecorder` microphone flows.
- Mulby does not wrap camera preview or microphone recording data. After permission checks, use standard browser APIs such as `navigator.mediaDevices.enumerateDevices()`, `navigator.mediaDevices.getUserMedia()`, and `MediaRecorder` in the renderer.
- Keep desktop capture and screen recording constraints in the Screen module. `screen.getMediaStreamConstraints()` uses `permissions.screen`; adding desktop video examples to Media would blur the module boundary and can lead to incorrect `camera` permission assumptions.
- TTS is renderer-only (`window.mulby.tts`) and belongs in Media. It should include voice loading, delayed `voiceschanged` refresh, playback controls, and state polling with `tts.isSpeaking()`.
- `shell.beep()` can stay in Media as an audio feedback example, but command execution, file opening, and other shell behaviors belong in File Manager or a dedicated shell module.
- Redact device IDs, group IDs, media track device IDs, and object URLs in `rawData`. Show stream shape, track settings, recording size, duration, and MIME type instead of exposing sensitive identifiers.

## Window and Child Window Module Lessons

- Prefer route-mode child windows: call `window.create('child-window', { loadMode: 'route', params })`. Do not use old `/index.html#...` paths unless migrating a multi-HTML legacy plugin with declared `manifest.assets`.
- `window.create()` loads the same plugin UI entry and passes routing through hash/search plus `onPluginInit().params`. Child pages should read both URL state and `onPluginInit()` payloads, because `options.params` are not guaranteed to appear as URL query parameters.
- Always return disposers from `window.onChildMessage()`, `subInput.onChange()`, and `onWindowStateChange()`. Re-registering these listeners on every child window state update causes duplicated messages.
- Keep current-window controls and child-window controls separate. Current-window APIs use `window.*`; child handles returned by `window.create()` expose their own `show`, `hide`, `focus`, `setBounds`, `setOpacity`, `postMessage`, `close`, and related methods.
- Demonstrate only windows created by the current plugin. The host enforces plugin ownership for child handles, and showcase pages should not try to operate host windows, settings pages, plugin manager windows, or super panel windows.
- Keep risky actions visible and scoped. Avoid casual demos of `window.hide()` and `window.terminatePlugin()`; `window.close()` is acceptable inside the child-window page where it only closes the current child window.
- Overlay examples are plugin-facing, but they should stay in the Window module and use `screen.getPrimaryDisplay()` only for geometry. Keep screen capture, recording, and media stream constraints in the Screen module.
- `window.startDrag()` needs real existing local files. Generate temporary files with `system.getPath('temp')` plus `filesystem.writeFile()`, or let the user choose a file with `dialog.showOpenDialog()`.
- `resizeDrag()` is for custom frameless/titlebar resize surfaces. Use a small explicit drag target rather than binding it to broad page areas.
- Move all route-mode, overlay, messaging, SubInput, find-in-page, and drag examples into the right-side `ApiReferencePanel`; main content should stay focused on live controls, state, message logs, and operation logs.

## InBrowser Module Lessons

- `inbrowser` is a renderer chain builder. Each chain method returns the same builder and nothing executes until `run()` is called.
- The host appends an `InBrowserInstance` object to the end of the `run()` result array when the browser window is still alive. UI code should split operation outputs from the trailing instance metadata before rendering raw data.
- Use a local `data:` fixture page for most live demos. It makes selectors stable, avoids relying on Google/Baidu or other external pages, and lets the module demonstrate input, mouse, upload, drop, cookies, screenshot, PDF, and extraction reliably.
- Keep external URL demos configurable and conservative. Do not hard-code private links, real cloud-drive shares, or unreachable test domains as default demo paths.
- Include current newer operations together: `dblclick`, `hover`, `input`, `when`, function-based `wait`, `markdown`, `screenshot`, `download`, `file`, `drop`, `setCookies`, `removeCookies`, and manager methods.
- `run(id, options)` is the correct way to reuse an existing hidden InBrowser instance. Store the trailing instance id from a previous result, and keep a separate action for `getIdleInBrowsers()`.
- `file()` and `drop()` need a real local path. Generate one with `system.getPath('temp')` plus `filesystem.writeFile()`, or let the user choose a file with `dialog.showOpenDialog()`.
- `pdf()` and `screenshot()` can either return binary data or save to a path. Showcase UI should prefer `dialog.showSaveDialog()` for explicit save paths and summarize returned binary data in `rawData`.
- `download()` is asynchronous from the browser session perspective; setting `savePath` controls the download target but the returned `run()` array may only contain instance metadata.
- `setInBrowserProxy()` is global to InBrowser manager state and existing active windows. Provide an explicit direct-mode action and avoid treating proxy settings as host Settings API.
- Do not add permissions for InBrowser itself. Add only related API permissions if the page calls permission-gated APIs; the current InBrowser page uses dialog/system/filesystem helpers and requires no new manifest permission.
- Update `src/types/mulby.d.ts` when InBrowser docs/preload support more methods than the local declaration. Avoid using `any` for the entire chain surface because it hides stale API examples.

## Sharp Module Lessons

- `sharp(input, options?)` is a renderer chain builder backed by main-process IPC. Chain methods only record operations; execution happens only when the page calls `toBuffer()`, `toFile()`, `metadata()`, or `stats()`.
- Do not bundle native `sharp` in the plugin. Use the host runtime through `window.mulby.sharp` or backend `context.api.sharp.execute`.
- Keep examples focused on plugin-facing image processing. It is valid to use helper APIs such as `dialog`, `filesystem`, `system.getPath('temp')`, and `screen.capture()` to acquire or save images, but the Sharp module should not drift into AI image generation, host icon services, clipboard history, or host-only image pipelines.
- `screen.capture()` is only an input-source helper and still requires `permissions.screen`; Sharp itself does not need a manifest permission.
- Cover the current host chain surface in grouped UI/API docs: geometry (`resize`, `extract`, `extend`, `trim`, `rotate`, `flip`, `flop`, `affine`), filtering/color (`median`, `blur`, `sharpen`, `flatten`, `gamma`, `negate`, `normalise`, `clahe`, `convolve`, `threshold`, `linear`, `recomb`, `modulate`, `tint`, colorspace), channels/composite (`ensureAlpha`, `removeAlpha`, `extractChannel`, `bandbool`, `composite`), output formats, metadata, timeout, and tile.
- Prefer live buttons for stable previewable formats such as PNG, JPEG, and WebP. List GIF/TIFF/AVIF/HEIF/RAW in the API panel because actual encoding support depends on the bundled sharp/libvips build returned by `getSharpVersion()`.
- `clone()` is documented, but current preload implementation does not create an independent operation list. Avoid making it a primary clickable demo until the host bridge is corrected; mention the concept only if needed.
- Redact binary outputs in `rawData`: show byte lengths, MIME headers, metadata, stats, and save paths instead of dumping ArrayBuffers, Data URLs, EXIF, ICC, IPTC, or XMP payloads.
- Use typed Sharp method options in `src/types/mulby.d.ts`. Broad `object` signatures hide stale examples and make page code less useful as API documentation.
- When saving, demonstrate both paths deliberately: `toBuffer()` plus `filesystem.writeFile()` for renderer-managed output, and `toFile(path)` for direct Sharp output.

## FFmpeg Module Lessons

- The current plugin-facing FFmpeg surface is intentionally small: `ffmpeg.isAvailable()`, `getVersion()`, `getPath()`, `download(onProgress?)`, and `run(args, onProgress?)`. Do not invent `ffprobe`, device listing, preset management, or host settings APIs unless the host exposes them.
- `ffmpeg.run()` returns a task object immediately. Keep that task in a ref so the UI can call `task.quit()` or `task.kill()` while `task.promise` is still pending.
- The progress callback is parsed from FFmpeg stderr and `percent` is only available when the host has parsed an input duration. UI should also display `time`, `speed`, `size`, `frame`, and `bitrate` so long-running tasks still show useful state when percent is missing.
- Media probing can be demonstrated with `ffmpeg.run(['-hide_banner', '-i', input])`: FFmpeg exits with an error, but stderr contains the stream metadata. Parse it deliberately and treat the expected error path as a successful information read only when duration or streams are present.
- Use argument arrays, not shell command strings. `ffmpeg.run(args)` spawns the host-managed binary directly, so examples should avoid `shell.runCommand`, command policy APIs, or any shell quoting requirement.
- Downloading FFmpeg is a host-managed runtime install. Show download phase and progress, but do not expose downloader URLs, host storage internals, or update settings.
- Use helper APIs only for workflow ergonomics: `dialog` for file paths, `filesystem.exists/stat` for output summaries, `system.getPath('temp')` for generated samples, `system.isWindows/isMacOS/isLinux` for platform-specific FFmpeg arguments, and basic `shell.showItemInFolder` to reveal outputs.
- Screen recording through FFmpeg is just a command-argument example and does not replace the Screen module's `screen.getMediaStreamConstraints()` workflow. Keep microphone/camera permission flows in Media and desktop stream permission flows in Screen.
- Redact raw FFmpeg stderr in `rawData`; keep a truncated preview, parsed streams, current command args, progress snapshot, and output file stat.
- Add a static manifest feature for `ffmpeg` so the sidebar module can also be opened directly from launcher keywords.

## Settings Module Lessons

- The showcase Settings page must not demonstrate `window.mulby.settings`. That API controls host settings, update center, startup behavior, and host shortcut recording, so it is outside plugin-facing examples.
- Keep this module focused on plugin UI settings and affordances. Do not duplicate storage demos here; persistent storage, encrypted KV, and attachments belong in the Storage and Security module.
- Theme examples should read and follow host theme state with `theme.get()`, `theme.getActual()`, and `onThemeChange()`. Avoid changing host-wide theme settings from the showcase page.
- Shortcut examples should use the current disposer returned by `shortcut.onTriggered()` and provide unregister actions, because global shortcuts are persistent side effects owned by the plugin.
- Tray examples should demonstrate plugin-owned `tray.create`, `setIcon`, `setTooltip`, `setTitle`, `exists`, and `destroy`, using local or data URL icons rather than external network images.
- Context-menu separators need to satisfy the local type definitions. Use a blank `label` for separator items or update the shared type deliberately after checking host types.
- Exclude tray-menu, host settings redirects, plugin manager, plugin store, AI settings redirects, and super panel flows from this module; those are host UI surfaces rather than normal plugin settings.

## Storage and Security Module Lessons

- Rename the old Security page to Storage and Security when it owns both `security` and `storage` examples. Keep the sidebar label and manifest feature explain aligned.
- This module is the single place for storage demos: basic KV (`get`, `set`, `remove`), V2 storage (`list`, `getMany`, `setMany`, `getMeta`, `setWithVersion`, `removeWithVersion`, `transaction`, `append`, `watch`), encrypted KV, and attachment storage.
- Keep storage demos scoped to a module-owned prefix such as `storage-security-demo:`. Do not call host storage explorer APIs such as `listNamespaces()` or `getAllWithMeta()` from plugin UI.
- `security.encryptString()` and `storage.encrypted.*` solve different problems. Show raw string encryption/decryption with redacted byte summaries, and use `storage.encrypted.*` for persistent secrets.
- Redact sensitive fields in `rawData`: encrypted values should show byte/base64 length and previews only; encrypted KV should show existence, label, token length, update time, and errors, not decrypted tokens.
- Attachment demos should use small generated JSON/text snapshots. Show MIME type, size, and truncated preview; never dump large binary buffers in the API panel.
- `storage.watch()` returns a disposer. Store it in a ref and always clean it up on unmount or when stopping the watcher.
- Keep destructive actions explicit and scoped to the module prefix. Avoid namespace-wide `clear()` in renderer examples.

## AI Module Lessons

- Keep the AI page plugin-facing. Demonstrate `ai.call`, streaming, abort, models, connection checks, token estimation, attachments, images, and read-only discovery, but exclude host-only or settings-management surfaces such as AI settings editors, MCP Server management, plugin-store flows, and system pages.
- Renderer streaming must follow the documented abort pattern: capture `chunk.__requestId` into a ref, keep an `abortedRef`, call top-level `ai.abort(requestId)`, and ignore late chunks after the user stops the request. Do not rely on `req.abort()` for text streaming in the renderer.
- Use the backend `rpc` namespace for internal per-call tool demos. A UI action can call `host.call('@mulby/showcase', 'runAiToolDemo', ...)`, and the backend can call `mulby.ai.call({ tools })`; the host injects plugin context so tool names route back to the plugin's exported `rpc` helpers.
- Do not add `manifest.tools` for an internal demo. `option.tools` is scoped to the current `ai.call`; `manifest.tools` is a public ecosystem contract and should only be added if the plugin intentionally exposes reusable tools to Mulby AI, other plugins, or external MCP clients.
- Keep AI settings and management APIs out of the module: no `ai.settings.*`, no MCP server create/remove/activate/deactivate/restart/check flows, no skill install/remove/enable/disable flows, no web-search provider updates, and no plugin-tool disabled-list writes.
- Read-only AI discovery is acceptable when useful: `ai.mcp.listServers()`, `ai.mcp.listTools(serverId)`, `ai.skills.listEnabled()`, `ai.skills.preview(input)`, `ai.tooling.webSearch.getSettings()`, and `ai.tooling.pluginTools.getDisabled()`.
- `ai.models.fetch()` and `ai.testConnection()` can accept provider credentials. Redact API keys and sensitive provider input in `rawData`, operation logs, and examples.
- Attachment and image examples should be guarded by model availability and user-selected paths. Show clear unavailable states when no image-capable model is configured.
- Redact large generated assets in `rawData`: show base64 lengths, previews, MIME type, token usage, and attachment IDs rather than dumping full images or file contents.
- Add a focused regression test for new modules that checks routing, manifest feature registration, API panel usage, required APIs, documented abort pattern, and excluded host-only APIs.

## Scheduler Module Lessons

- Keep task creation in the plugin backend. The current docs mark `scheduler.schedule(task)` as a backend API, so the showcase UI should call `host.call('@mulby/showcase', 'scheduleShowcaseDelayTask' | 'scheduleShowcaseOnceTask' | 'scheduleShowcaseRepeatTask', input)` and let `src/main.ts` call `mulby.scheduler.schedule()`.
- Renderer code should demonstrate task inspection and management: `scheduler.listTasks`, `getTask`, `getTaskCount`, `getExecutions`, `pauseTask`, `resumeTask`, `cancelTask`, `deleteTasks`, `cleanupTasks`, `subscribe`, `onEvent`, `unsubscribe`, and Cron helpers.
- Do not demonstrate the host task scheduler system page, `systemPage.open({ page: 'task-scheduler' })`, `app.onOpenTaskScheduler`, or host settings redirects. Those are host UI surfaces, not normal plugin-facing workflows.
- Filter task lists by the plugin id (`@mulby/showcase`) when using renderer APIs. Backend `context.api.scheduler.list()` injects plugin id automatically, but renderer IPC exposes a global scheduler list and needs explicit scoping.
- Scheduler callbacks exported from `src/main.ts` are invoked by the current host worker as `(context, payload, task)`, even though docs also describe a single-object `{ api, payload, task }` shape. Write callbacks defensively so they can resolve payload/task from either form.
- Always return a small serializable value from task callbacks; it is recorded in execution history. Avoid returning large payloads, binary data, or sensitive data.
- Event subscriptions must store the disposer returned by `scheduler.onEvent()` and call both the disposer and `scheduler.unsubscribe()` on unmount or when stopping the stream.
- Repeat-task demos should set a visible `maxExecutions` default to avoid leaving unbounded recurring tasks behind. Cleanup actions should be explicit and describe that only terminal records are cleaned by `cleanupTasks()`.
- Destructive actions should be scoped and visible: delete only the selected task through `deleteTasks([task.id])`; use confirmation before deleting non-terminal tasks or running broader cleanup.
- Add a focused module regression test for new missing modules. Check the right-side API panel, route/sidebar/manifest registration, backend callback/RPC exports, used scheduler APIs, and excluded host-only API names.
