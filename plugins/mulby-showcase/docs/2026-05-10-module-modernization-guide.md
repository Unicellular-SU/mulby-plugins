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
