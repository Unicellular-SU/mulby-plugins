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
- `getMediaStreamConstraints({ audio: true })` needs `permissions.screen` plus `permissions.microphone`. If the screen page demonstrates audio recording constraints, show microphone permission state but keep camera permission in Media.
- Avoid routing from the screen page into unrelated plugins or host pages. Color picking should demonstrate `screen.colorPick()` and clipboard copy only, not plugin orchestration.
- Raw data should summarize thumbnails and screenshots instead of storing full Data URLs. Include capture metadata, selected source IDs, bounds, generated media constraints, coordinate conversions, and operation logs.
