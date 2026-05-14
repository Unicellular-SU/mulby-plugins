# Mulby Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `plugins/mulby-demo` as a reference Mulby plugin that documents and demonstrates public third-party plugin APIs while explicitly marking internal or settings-only host APIs.

**Architecture:** The plugin uses a React UI with a typed example registry. Each API module exports metadata and executable examples; the UI groups modules dynamically from the registry and calls renderer examples directly or backend examples through `window.mulby.host.call`. Backend code registers AI tools, scheduler callbacks, feature examples, and host RPC methods without requiring UI changes for every new module.

**Tech Stack:** Mulby plugin manifest, React 18, Vite 5, TypeScript, esbuild, Node test runner.

---

## File Structure

- `plugins/mulby-demo/manifest.json`: plugin contract, permissions, features, AI tool schemas, window settings.
- `plugins/mulby-demo/package.json`: build, test, and pack scripts.
- `plugins/mulby-demo/tsconfig.json`: strict TS config for UI and backend.
- `plugins/mulby-demo/vite.config.ts`: Vite build to root `ui/`.
- `plugins/mulby-demo/src/main.ts`: backend lifecycle, host RPC, scheduler callbacks, tool registration.
- `plugins/mulby-demo/src/shared/api-catalog.ts`: public API and excluded API catalog used by UI and README.
- `plugins/mulby-demo/src/ui/examples/types.ts`: example metadata and runner types.
- `plugins/mulby-demo/src/ui/examples/registry.ts`: ordered registry API and grouping utilities.
- `plugins/mulby-demo/src/ui/examples/*.example.ts`: focused module examples.
- `plugins/mulby-demo/src/ui/App.tsx`: reference UI, module navigation, runner panel, boundary notes.
- `plugins/mulby-demo/src/ui/styles.css`: work-focused UI styling.
- `plugins/mulby-demo/src/ui/hooks/useMulby.ts`: narrow typed access helpers.
- `plugins/mulby-demo/src/ui/index.html` and `src/ui/main.tsx`: frontend entry.
- `plugins/mulby-demo/src/types/mulby.d.ts`: local Mulby type surface for compilation.
- `plugins/mulby-demo/assets/icon.svg` and `icon.png`: source and packaged icon.
- `plugins/mulby-demo/README.md`: official reference usage and extension guide.

## Tasks

### Task 1: Create Plugin Skeleton

- [x] Confirm `plugins/mulby-demo` does not exist.
- [ ] Create React Mulby plugin structure using the CLI when available, otherwise mirror existing repo template.
- [ ] Define `manifest.json` with `open-reference`, `run-smoke-demo`, and `open-detached-reference` features.
- [ ] Add `tools` schemas for `mulby_demo_echo` and `mulby_demo_catalog`.
- [ ] Declare permissions needed by examples, including clipboard, notification, screen, microphone, camera, geolocation, accessibility, inputMonitor, and runCommand.

### Task 2: Test-First Registry Core

- [ ] Write Node tests for registry grouping, duplicate detection, and public/excluded API coverage checks.
- [ ] Run the tests and observe failures before implementation.
- [ ] Implement `api-catalog.ts`, `types.ts`, and `registry.ts`.
- [ ] Run tests again and keep the registry behavior passing.

### Task 3: Backend Public API Examples

- [ ] Implement lifecycle logging, `run`, host RPC methods, scheduler callbacks, dynamic feature operations, messaging helpers, and AI tool registration in `src/main.ts`.
- [ ] Keep backend examples side-effect-light and return structured JSON results.
- [ ] Expose host methods used by UI examples: `runBackendExample`, `listBackendExamples`, `getCatalogSummary`, and `echo`.

### Task 4: Renderer API Modules

- [ ] Create example modules grouped by responsibility: data, files/network, UI/window, system/device, plugin/collaboration, AI/media, and restricted/internal.
- [ ] Ensure each module includes description, context, method list, required permissions, runnable examples, and notes.
- [ ] Make destructive or global APIs preview-first by default; only read status or show explicit safe payloads.

### Task 5: UI Shell

- [ ] Build a dense reference UI that discovers registered modules dynamically.
- [ ] Provide module search/filter, method lists, permission tags, code snippets, run buttons, output panel, and excluded API boundary section.
- [ ] Avoid marketing layout; first screen is the usable reference browser.

### Task 6: Documentation and Icon

- [ ] Write README with API scope, excluded APIs, run/build commands, project structure, and extension steps.
- [ ] Add a plugin-specific SVG icon and generate a root `icon.png`.

### Task 7: Verification

- [ ] Run `pnpm install` if dependencies are missing.
- [ ] Run `pnpm run test`.
- [ ] Run `pnpm run build`.
- [ ] Run `pnpm run pack` if the Mulby CLI is available.
- [ ] Re-read requirements and confirm public API coverage and excluded API boundary are documented.
