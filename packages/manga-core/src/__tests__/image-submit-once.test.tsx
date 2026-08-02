import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useEffect, useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import CharacterGenerator from '../components/CharacterGenerator';
import { useImageQueue } from '../hooks/useImageQueue';
import { setTheme } from '../theme/registry';
import { setActiveProjectId } from '../services/persistenceService';
import techTheme from '../../../../plugins/tech-manga/theme';
import type { ComicPageData } from '../engine-types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
setTheme(techTheme);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryableDownloadError = () => Object.assign(new Error('download failed'), {
  code: 'download_failed',
  phase: 'download',
  taskId: 'task-1',
  retryable: true,
  billed: 'yes',
  recoveryAction: 'resume_download',
});

const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return textOf((value as { children?: unknown }).children);
  }
  return '';
};

const waitFor = async (check: () => void, timeoutMs = 7000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
    }
    await act(async () => { await sleep(25); });
  }
  throw lastError;
};

type HostCounters = {
  characterCalls: number;
  propCalls: number;
  sceneCalls: number;
  panelCalls: number;
};

const installHost = (
  counters: HostCounters,
  imageResult: (kind: keyof HostCounters) => Promise<{ images: string[]; tokens: { inputTokens: number; outputTokens: number } }>,
) => {
  const classify = (prompt: string): keyof HostCounters => {
    if (prompt.includes('Subject: The character')) return 'characterCalls';
    if (prompt.includes('Subject: Official Design of Item/Prop')) return 'propCalls';
    if (prompt.includes('Subject: Official Design of Location/Scene')) return 'sceneCalls';
    throw new Error(`Unexpected image prompt: ${prompt}`);
  };
  const failOrResolve = (kind: keyof HostCounters) => {
    counters[kind] += 1;
    return imageResult(kind);
  };
  const ai = {
    allModels: async () => [{ id: 'test-image-model' }],
    call: async () => ({ content: '' }),
    abort: async () => undefined,
    tokens: { estimate: async () => ({ inputTokens: 0, outputTokens: 0 }) },
    attachments: {
      upload: async () => ({ attachmentId: 'reference-attachment' }),
      get: async () => ({ attachmentId: 'reference-attachment' }),
      delete: async () => undefined,
    },
    images: {
      generate: async (input: { prompt: string }) => failOrResolve(classify(input.prompt)),
      generateStream: async (input: { prompt: string }, _onChunk: (chunk: unknown) => void) =>
        failOrResolve(classify(input.prompt)),
      edit: async (_input: unknown) => failOrResolve('panelCalls'),
    },
  };
  (globalThis as any).window = { mulby: { ai } };
  (globalThis as any).document = { hidden: true };
};

const renderAssets = () => TestRenderer.create(
  <CharacterGenerator
    characters={[{ name: 'Character failure', description: 'test character' }]}
    props={[{ name: 'Prop failure', description: 'test prop' }]}
    scenes={[{ name: 'Scene failure', description: 'test scene' }]}
    style="test style"
    mainCharacterName="Character failure"
    storyMode="conflict"
    onUpdateCharacter={() => undefined}
    onUpdateProp={() => undefined}
    onUpdateScene={() => undefined}
    onConfirm={() => undefined}
    onUsageCallback={() => undefined}
  />
);

test('character, prop, scene, and referenced panel failures submit one host image operation', async () => {
  const counters: HostCounters = { characterCalls: 0, propCalls: 0, sceneCalls: 0, panelCalls: 0 };
  installHost(counters, async () => { throw retryableDownloadError(); });
  setActiveProjectId('image-once-test');

  let pageState: ComicPageData[] = [{
    page_number: 1,
    layout_description: 'one panel',
    image_prompt: 'draw a panel',
    characters_in_scene: [],
    props_in_scene: [],
    persistent_states: { characters: [], environment: { lighting: 'day', notable_changes: [] } },
    state_changes_this_page: [],
    isGenerating: true,
  }];
  let trigger: ((page: ComicPageData, ratio: string, references?: string[]) => Promise<void>) | undefined;

  const Harness = () => {
    const [pages, setPages] = useState(pageState);
    const queue = useImageQueue({
      pages,
      setPages: (updater) => setPages(previous => {
        pageState = updater(previous);
        return pageState;
      }),
      batchRef: { current: { active: false, epoch: 0 } },
      trackUsage: () => undefined,
      handlePermissionError: () => false,
      notify: () => undefined,
    });
    useEffect(() => { trigger = queue.triggerImageGeneration; }, [queue.triggerImageGeneration]);
    return null;
  };

  let assets: TestRenderer.ReactTestRenderer;
  await act(async () => {
    assets = renderAssets();
    TestRenderer.create(<Harness />);
  });
  await waitFor(() => assert.ok(trigger));
  await act(async () => { await trigger!(pageState[0], '2:3', ['data:image/png;base64,AA==']); });

  await waitFor(() => {
    assert.match(textOf(assets!.toJSON()), /download failed/);
    assert.match(pageState[0].error || '', /download failed/);
  });
  assert.equal(counters.characterCalls, 1);
  assert.equal(counters.propCalls, 1);
  assert.equal(counters.sceneCalls, 1);
  assert.equal(counters.panelCalls, 1);
});

test('two CharacterGenerator instances adopt one shared in-flight request and each receive its update', async () => {
  const counters: HostCounters = { characterCalls: 0, propCalls: 0, sceneCalls: 0, panelCalls: 0 };
  let resolveImage: ((value: { images: string[]; tokens: { inputTokens: number; outputTokens: number } }) => void) | undefined;
  const hostResult = new Promise<{ images: string[]; tokens: { inputTokens: number; outputTokens: number } }>((resolve) => {
    resolveImage = resolve;
  });
  installHost(counters, async () => hostResult);

  const updatesA: unknown[] = [];
  const updatesB: unknown[] = [];
  const props = {
    characters: [{ name: 'Shared flight', description: 'same asset' }],
    style: 'test style',
    mainCharacterName: 'Shared flight',
    storyMode: 'conflict',
    onUpdateProp: () => undefined,
    onUpdateScene: () => undefined,
    onConfirm: () => undefined,
    onUsageCallback: () => undefined,
  };

  await act(async () => {
    TestRenderer.create(<CharacterGenerator {...props} onUpdateCharacter={(index, value) => updatesA.push({ index, value })} />);
    TestRenderer.create(<CharacterGenerator {...props} onUpdateCharacter={(index, value) => updatesB.push({ index, value })} />);
  });
  await waitFor(() => assert.equal(counters.characterCalls, 1));
  await act(async () => {
    resolveImage!({ images: ['aGVsbG8='], tokens: { inputTokens: 0, outputTokens: 0 } });
  });
  await waitFor(() => {
    assert.equal(updatesA.length, 1);
    assert.equal(updatesB.length, 1);
  });
  assert.equal(counters.characterCalls, 1);
});
