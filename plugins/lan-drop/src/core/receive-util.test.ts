// 安全核心：入站路径净化 / 落盘越界回退 / 同名去重。
// 目录穿越是文件接收类工具最常见的高危漏洞，这里把两道防线都钉死。

import { describe, it, expect } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  safeRelPath,
  resolveWithinDownloadDir,
  dedupePath,
  formatSize,
  decodeHeader,
} from './receive-util'

const sep = path.sep
const seg = (...parts: string[]) => parts.join(sep)

describe('safeRelPath', () => {
  it('strips parent-dir traversal segments', () => {
    expect(safeRelPath('../../etc/passwd')).toBe(seg('etc', 'passwd'))
    expect(safeRelPath('..\\..\\windows\\system32')).toBe(seg('windows', 'system32'))
    expect(safeRelPath('foo/../../bar')).toBe(seg('foo', 'bar'))
  })

  it('drops leading separators (no absolute escape)', () => {
    expect(safeRelPath('/etc/passwd')).toBe(seg('etc', 'passwd'))
    expect(safeRelPath('\\\\server\\share')).toBe(seg('server', 'share'))
    const r = safeRelPath('/etc/passwd')
    expect(r.startsWith(sep)).toBe(false)
  })

  it('removes "." segments and preserves legit nesting', () => {
    expect(safeRelPath('a/./b')).toBe(seg('a', 'b'))
    expect(safeRelPath('sub/dir/file.txt')).toBe(seg('sub', 'dir', 'file.txt'))
  })

  it('replaces illegal / control characters', () => {
    expect(safeRelPath('a<b>c')).toBe('a_b_c')
    expect(safeRelPath('na:me?.txt')).toBe('na_me_.txt')
    expect(safeRelPath('tab\tname')).toBe('tab_name')
  })

  it('strips a drive letter into a harmless relative segment', () => {
    const r = safeRelPath('C:\\Windows\\System32')
    expect(r).toBe(seg('C_', 'Windows', 'System32'))
    expect(path.isAbsolute(r)).toBe(false)
  })

  it('trims trailing dots/spaces per segment (Windows rules)', () => {
    expect(safeRelPath('foo./bar ')).toBe(seg('foo', 'bar'))
    expect(safeRelPath('name...')).toBe('name')
  })

  it('collapses purely-malicious input to empty', () => {
    expect(safeRelPath('..')).toBe('')
    expect(safeRelPath('../../..')).toBe('')
    expect(safeRelPath('')).toBe('')
    expect(safeRelPath('   ')).toBe('')
  })
})

describe('resolveWithinDownloadDir', () => {
  const root = path.resolve(os.tmpdir(), 'ld-resolve-root')

  it('keeps a legit nested relative path inside the download dir', () => {
    const p = resolveWithinDownloadDir(root, seg('sub', 'file.txt'), 'file.txt')
    expect(p === root || p.startsWith(root + sep)).toBe(true)
    expect(p.endsWith(seg('sub', 'file.txt'))).toBe(true)
  })

  it('falls back to the basename when the relative path escapes the dir', () => {
    const escaped = resolveWithinDownloadDir(root, seg('..', '..', 'evil.txt'), 'evil.txt')
    expect(escaped).toBe(path.resolve(root, 'evil.txt'))
  })

  it('never resolves outside the dir even for adversarial pre-sanitized input', () => {
    const nasties = [
      '../../etc/passwd',
      '..\\..\\Windows\\System32\\drivers\\etc\\hosts',
      '/abs/evil',
      'C:\\evil',
      'a/../../../b',
    ]
    for (const n of nasties) {
      // 真实管道：先 safeRelPath 净化，再 resolveWithinDownloadDir 兜底。
      const p = resolveWithinDownloadDir(root, safeRelPath(n), 'fallback.bin')
      expect(p === root || p.startsWith(root + sep)).toBe(true)
    }
  })
})

describe('dedupePath', () => {
  it('returns the original path when nothing exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-dedupe-'))
    try {
      const target = path.join(dir, 'a.txt')
      expect(dedupePath(target)).toBe(target)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('appends an incrementing suffix to avoid overwriting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-dedupe-'))
    try {
      const target = path.join(dir, 'a.txt')
      fs.writeFileSync(target, '1')
      const d1 = dedupePath(target)
      expect(d1).toBe(path.join(dir, 'a (1).txt'))

      fs.writeFileSync(d1, '2')
      const d2 = dedupePath(target)
      expect(d2).toBe(path.join(dir, 'a (2).txt'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('helpers', () => {
  it('formatSize renders human-readable sizes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(1536)).toBe('1.5 KB')
  })

  it('decodeHeader decodes URI components and is failure-tolerant', () => {
    expect(decodeHeader('%E6%96%87%E4%BB%B6')).toBe('文件')
    expect(decodeHeader(undefined)).toBe('')
    expect(decodeHeader('')).toBe('')
    expect(decodeHeader('plain.txt')).toBe('plain.txt')
    expect(decodeHeader('%')).toBe('%') // 非法编码 → 原样返回，不抛错
  })
})
