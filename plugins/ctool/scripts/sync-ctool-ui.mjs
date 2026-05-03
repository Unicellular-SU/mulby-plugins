#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CTOOL_REPO = 'https://github.com/baiy/Ctool.git'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(pluginRoot, '..', '..')
const ctoolRoot = path.resolve(repoRoot, 'upstream', 'Ctool')
const source = path.resolve(ctoolRoot, 'packages', 'ctool-core', 'dist')
const target = path.resolve(pluginRoot, 'ui')

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function ensureCtoolSource() {
  if (existsSync(path.join(ctoolRoot, 'package.json'))) {
    return
  }

  mkdirSync(path.dirname(ctoolRoot), { recursive: true })
  run('git', ['clone', '--depth', '1', CTOOL_REPO, ctoolRoot], repoRoot)
}

function ensureCtoolBuild() {
  if (existsSync(source)) {
    return
  }

  run('pnpm', ['install', '--frozen-lockfile'], ctoolRoot)
  run('pnpm', ['run', 'build'], ctoolRoot)
}

ensureCtoolSource()
ensureCtoolBuild()

if (!existsSync(source)) {
  throw new Error(`Ctool build output not found after build: ${source}`)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })

console.log(`Synced Ctool UI: ${path.relative(repoRoot, source)} -> ${path.relative(repoRoot, target)}`)
