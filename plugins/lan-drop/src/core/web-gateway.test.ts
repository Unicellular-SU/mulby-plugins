// 桌面→手机 ZIP 打包的纯逻辑：条目路径净化（防 zip-slip 穿越解压）、
// 公共顶层文件夹推断（zip 命名）、下载文件名净化。

import { describe, it, expect } from 'vitest'
import { safeZipEntryPath, safeFileName, commonTopFolder } from './web-gateway'
import type { FileMeta } from './types'

const f = (relPath: string, name = relPath.split('/').pop() || relPath): FileMeta => ({
  path: '/abs/' + relPath,
  name,
  relPath,
  size: 1,
})

describe('safeZipEntryPath (zip-slip defense)', () => {
  it('strips parent-dir traversal but keeps the path relative', () => {
    expect(safeZipEntryPath('../../etc/passwd')).toBe('etc/passwd')
    expect(safeZipEntryPath('folder/../../../evil')).toBe('folder/evil')
    expect(safeZipEntryPath('..\\..\\Windows\\System32')).toBe('Windows/System32')
  })

  it('drops leading separators / absolute prefixes', () => {
    expect(safeZipEntryPath('/abs/x')).toBe('abs/x')
    expect(safeZipEntryPath('C:\\Win\\x')).toBe('C_/Win/x')
    expect(safeZipEntryPath('/abs/x').startsWith('/')).toBe(false)
  })

  it('preserves legit nested structure with POSIX separators', () => {
    expect(safeZipEntryPath('myfolder/sub/a.txt')).toBe('myfolder/sub/a.txt')
  })

  it('collapses purely-malicious input to empty', () => {
    expect(safeZipEntryPath('..')).toBe('')
    expect(safeZipEntryPath('../../..')).toBe('')
    expect(safeZipEntryPath('')).toBe('')
  })
})

describe('commonTopFolder', () => {
  it('returns the shared top folder when all files share one', () => {
    expect(commonTopFolder([f('docs/a.txt'), f('docs/sub/b.txt')])).toBe('docs')
  })

  it('returns null when files live under different roots', () => {
    expect(commonTopFolder([f('docs/a.txt'), f('pics/b.png')])).toBeNull()
  })

  it('returns null for loose top-level files (no folder prefix)', () => {
    expect(commonTopFolder([f('a.txt'), f('b.txt')])).toBeNull()
  })

  it('falls back to name when relPath is absent', () => {
    expect(commonTopFolder([{ path: '/x', name: 'a.txt', size: 1 }])).toBeNull()
  })
})

describe('safeFileName', () => {
  it('strips separators and illegal characters', () => {
    expect(safeFileName('a/b\\c.zip')).toBe('abc.zip')
    expect(safeFileName('na:me?.zip')).toBe('na_me_.zip')
  })

  it('keeps a normal name and falls back when empty', () => {
    expect(safeFileName('folder.zip')).toBe('folder.zip')
    expect(safeFileName('')).toBe('download')
    expect(safeFileName('   ')).toBe('download')
  })
})
