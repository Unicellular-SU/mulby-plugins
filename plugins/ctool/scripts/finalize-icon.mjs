#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const candidates = [
  path.join(os.homedir(), '.agents/skills/develop-mulby-plugin/scripts/finalize_plugin_icon.mjs'),
  path.join(os.homedir(), '.codex/skills/develop-mulby-plugin/scripts/finalize_plugin_icon.mjs'),
]

const script = candidates.find((candidate) => existsSync(candidate))

if (!script) {
  throw new Error(`Unable to find develop-mulby-plugin finalize_plugin_icon.mjs in:\n${candidates.join('\n')}`)
}

execFileSync('node', [
  script,
  '--project-root',
  '.',
  '--sharp-root',
  '../text-compare',
], { stdio: 'inherit' })
