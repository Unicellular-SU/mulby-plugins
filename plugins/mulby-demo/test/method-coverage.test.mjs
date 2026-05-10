import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

async function importRegistryFixture() {
  const projectRoot = path.resolve(import.meta.dirname, '..')
  const tempDir = await mkdtemp(path.join(tmpdir(), 'mulby-demo-methods-'))
  const entryPath = path.join(tempDir, 'fixture.ts')
  const outPath = path.join(tempDir, 'fixture.mjs')
  const registryPath = path.join(projectRoot, 'src/ui/examples/registry.ts').replace(/\\/g, '/')
  const catalogPath = path.join(projectRoot, 'src/shared/api-catalog.ts').replace(/\\/g, '/')
  const methodDetailsPath = path.join(projectRoot, 'src/shared/method-details.ts').replace(/\\/g, '/')

  await writeFile(entryPath, `
    export { apiExamples } from ${JSON.stringify(registryPath)}
    export { publicApiCatalog, restrictedApiCatalog } from ${JSON.stringify(catalogPath)}
    export { methodDetails } from ${JSON.stringify(methodDetailsPath)}
  `)

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: outPath,
    logLevel: 'silent'
  })

  try {
    return await import(pathToFileURL(outPath).href)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

test('every public API method is covered by a runnable demo', async () => {
  const { apiExamples, publicApiCatalog } = await importRegistryFixture()
  const examplesByCode = new Map(apiExamples.map((module) => [module.code, module]))
  const missing = []

  for (const catalogEntry of publicApiCatalog) {
    const module = examplesByCode.get(catalogEntry.code)
    assert.ok(module, `missing module examples for ${catalogEntry.code}`)

    const coveredMethods = new Set(module.examples.flatMap((example) => example.methods ?? []))
    for (const method of catalogEntry.methods) {
      if (!coveredMethods.has(method)) {
        missing.push(`${catalogEntry.code}:${method}`)
      }
    }
  }

  assert.deepEqual(missing, [])
})

test('documented pluginStore renderer API is public and runnable', async () => {
  const { apiExamples, publicApiCatalog, restrictedApiCatalog } = await importRegistryFixture()
  const publicEntry = publicApiCatalog.find((entry) => entry.code === 'plugin-store')
  const restrictedEntry = restrictedApiCatalog.find((entry) => entry.code === 'plugin-store')
  const exampleModule = apiExamples.find((entry) => entry.code === 'plugin-store')

  assert.ok(publicEntry, 'plugin-store should be part of public API catalog')
  assert.equal(restrictedEntry, undefined)
  assert.ok(exampleModule, 'plugin-store should have runnable examples')
  assert.deepEqual(
    publicEntry.methods,
    ['pluginStore.fetch', 'pluginStore.installFromUrl', 'pluginStore.checkUpdatesInstalled', 'pluginStore.updateAll']
  )
})

test('public API demos are runnable and are not documentation-only placeholders', async () => {
  const { apiExamples } = await importRegistryFixture()
  const invalid = []

  for (const module of apiExamples.filter((entry) => entry.category !== 'restricted')) {
    for (const example of module.examples) {
      if (typeof example.run !== 'function') {
        invalid.push(`${module.code}:${example.id}:missing run`)
      }
      if (example.safety === 'preview-only') {
        invalid.push(`${module.code}:${example.id}:preview-only`)
      }
    }
  }

  assert.deepEqual(invalid, [])
})

test('every public API method has clickable detail metadata', async () => {
  const { methodDetails, publicApiCatalog } = await importRegistryFixture()
  const missing = []
  const incomplete = []

  for (const catalogEntry of publicApiCatalog) {
    for (const method of catalogEntry.methods) {
      const detail = methodDetails[method]
      if (!detail) {
        missing.push(method)
        continue
      }

      if (!detail.summary?.en || !detail.summary?.zh) incomplete.push(`${method}:summary`)
      if (!Array.isArray(detail.inputs) || detail.inputs.length === 0) incomplete.push(`${method}:inputs`)
      if (!detail.returns?.en || !detail.returns?.zh) incomplete.push(`${method}:returns`)
    }
  }

  assert.deepEqual(missing, [])
  assert.deepEqual(incomplete, [])
})

test('clipboard method chips expose concrete input and output docs', async () => {
  const { methodDetails } = await importRegistryFixture()
  const expectations = {
    'clipboard.readText': ['none', 'Promise<string>'],
    'clipboard.writeText': ['text', 'Promise<void>'],
    'clipboard.readImage': ['none', 'Uint8Array'],
    'clipboard.writeImage': ['image', 'Promise<boolean>'],
    'clipboard.readFiles': ['none', 'path, name, size'],
    'clipboard.writeFiles': ['filePaths', 'Promise<boolean>'],
    'clipboard.getFormat': ['none', "'text' | 'image' | 'files'"]
  }

  for (const [method, [inputName, returnNeedle]] of Object.entries(expectations)) {
    const detail = methodDetails[method]
    assert.ok(detail, `missing detail for ${method}`)
    assert.ok(detail.summary.zh.includes('剪贴板'), `missing Chinese clipboard summary for ${method}`)
    assert.equal(detail.inputs[0].name, inputName)
    assert.ok(detail.returns.en.includes(returnNeedle), `return docs for ${method} should mention ${returnNeedle}`)
  }
})

test('clipboard history examples use backend host rpc because renderer preload does not expose clipboardHistory', async () => {
  const { apiExamples } = await importRegistryFixture()
  const module = apiExamples.find((entry) => entry.code === 'clipboard-history')
  assert.ok(module, 'missing clipboard-history module')

  for (const example of module.examples) {
    assert.match(example.code, /runBackendExample/)
    assert.doesNotMatch(example.code, /window\.mulby\.clipboardHistory/)
  }
})
