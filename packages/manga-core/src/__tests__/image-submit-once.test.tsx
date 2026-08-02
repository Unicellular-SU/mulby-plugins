import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useEffect, useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import CharacterGenerator from '../components/CharacterGenerator';
import { useImageQueue } from '../hooks/useImageQueue';
import { setTheme } from '../theme/registry';
import { getActiveProjectId, setActiveProjectId } from '../services/persistenceService';
import { abortAllAiTasks, clearReferenceAttachmentCache } from '../services/mulbyAiService';
import techTheme from '../../../../plugins/tech-manga/theme';
import type { ComicPageData } from '../engine-types';

const RETRY_WINDOW_MS = 1_650;
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

const waitFor = async (check: () => void, timeoutMs = 7_000) => {
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

type ImageResult = { images: string[]; tokens: { inputTokens: number; outputTokens: number } };
type HostCounter = { calls: number };

const installFailingHost = (): HostCounter => {
  const counter = { calls: 0 };
  const fail = async (): Promise<ImageResult> => {
    counter.calls += 1;
    throw retryableDownloadError();
  };
  (globalThis as any).window = {
    mulby: {
      ai: {
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
          generate: fail,
          generateStream: async (_input: unknown, _onChunk: (chunk: unknown) => void) => fail(),
          edit: fail,
        },
      },
    },
  };
  return counter;
};

const findTab = (renderer: TestRenderer.ReactTestRenderer, label: string) => {
  const tab = renderer.root.findAllByType('button').find(button => textOf(button.props.children) === label);
  assert.ok(tab, `expected ${label} tab`);
  return tab;
};

const restoreGlobal = (name: 'window' | 'document' | 'IS_REACT_ACT_ENVIRONMENT', descriptor?: PropertyDescriptor) => {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete (globalThis as any)[name];
};

const withIsolatedEnvironment = async (run: (addRenderer: (renderer: TestRenderer.ReactTestRenderer) => void) => Promise<void>) => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const priorActFlag = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const priorProjectId = getActiveProjectId();
  const renderers: TestRenderer.ReactTestRenderer[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { hidden: true } });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
  setTheme(techTheme);
  setActiveProjectId(`image-once-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await run(renderer => renderers.push(renderer));
  } finally {
    // No delayed auto-generation is allowed to reach the next test's host boundary.
    abortAllAiTasks();
    clearReferenceAttachmentCache();
    await act(async () => {
      renderers.splice(0).forEach(renderer => renderer.unmount());
      await sleep(0);
    });
    setActiveProjectId(priorProjectId);
    restoreGlobal('window', priorWindow);
    restoreGlobal('document', priorDocument);
    restoreGlobal('IS_REACT_ACT_ENVIRONMENT', priorActFlag);
  }
};

const assertOneCallPastRetryWindow = async (counter: HostCounter) => {
  await act(async () => { await sleep(RETRY_WINDOW_MS); });
  assert.equal(counter.calls, 1);
};

test('a failed character reference settles visibly after one host submission', { concurrency: false }, async () => {
  await withIsolatedEnvironment(async addRenderer => {
    const counter = installFailingHost();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CharacterGenerator
          characters={[{ name: 'Character failure', description: 'test character' }]}
          style="test style"
          mainCharacterName="Character failure"
          storyMode="conflict"
          onUpdateCharacter={() => undefined}
          onConfirm={() => undefined}
          onUsageCallback={() => undefined}
        />
      );
      addRenderer(renderer!);
    });
    await waitFor(() => assert.match(textOf(renderer!.toJSON()), /download failed/));
    await assertOneCallPastRetryWindow(counter);
  });
});

test('a failed prop reference settles visibly after one host submission', { concurrency: false }, async () => {
  await withIsolatedEnvironment(async addRenderer => {
    const counter = installFailingHost();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CharacterGenerator
          characters={[]}
          props={[{ name: 'Prop failure', description: 'test prop' }]}
          style="test style"
          mainCharacterName="Character failure"
          storyMode="conflict"
          onUpdateCharacter={() => undefined}
          onUpdateProp={() => undefined}
          onConfirm={() => undefined}
          onUsageCallback={() => undefined}
        />
      );
      addRenderer(renderer!);
    });
    await act(async () => { findTab(renderer!, techTheme.strings.propsTab(1)).props.onClick(); });
    await waitFor(() => assert.match(textOf(renderer!.toJSON()), /download failed/));
    await assertOneCallPastRetryWindow(counter);
  });
});

test('a failed scene reference settles visibly after one host submission', { concurrency: false }, async () => {
  await withIsolatedEnvironment(async addRenderer => {
    const counter = installFailingHost();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CharacterGenerator
          characters={[]}
          scenes={[{ name: 'Scene failure', description: 'test scene' }]}
          style="test style"
          mainCharacterName="Character failure"
          storyMode="conflict"
          onUpdateCharacter={() => undefined}
          onUpdateScene={() => undefined}
          onConfirm={() => undefined}
          onUsageCallback={() => undefined}
        />
      );
      addRenderer(renderer!);
    });
    await act(async () => { findTab(renderer!, techTheme.strings.scenesTab(1)).props.onClick(); });
    await waitFor(() => assert.match(textOf(renderer!.toJSON()), /download failed/));
    await assertOneCallPastRetryWindow(counter);
  });
});

test('a failed referenced panel settles its page state after one images.edit submission', { concurrency: false }, async () => {
  await withIsolatedEnvironment(async addRenderer => {
    const routes = { editCalls: 0, generateCalls: 0, generateStreamCalls: 0 };
    let attachmentUploads = 0;
    let editInput: { imageAttachmentId?: string; referenceAttachmentIds?: string[] } | undefined;
    const unexpectedRoute = async (route: 'generateCalls' | 'generateStreamCalls'): Promise<ImageResult> => {
      routes[route] += 1;
      const error = retryableDownloadError();
      error.message = `download failed: unexpected images.${route === 'generateCalls' ? 'generate' : 'generateStream'} route`;
      throw error;
    };
    (globalThis as any).window = {
      mulby: {
        ai: {
          allModels: async () => [{ id: 'test-image-model' }],
          call: async () => ({ content: '' }),
          abort: async () => undefined,
          tokens: { estimate: async () => ({ inputTokens: 0, outputTokens: 0 }) },
          attachments: {
            upload: async () => ({ attachmentId: `reference-attachment-${++attachmentUploads}` }),
            get: async () => ({ attachmentId: 'reference-attachment' }),
            delete: async () => undefined,
          },
          images: {
            generate: async () => unexpectedRoute('generateCalls'),
            generateStream: async (_input: unknown, _onChunk: (chunk: unknown) => void) => unexpectedRoute('generateStreamCalls'),
            edit: async (input: { imageAttachmentId?: string; referenceAttachmentIds?: string[] }) => {
              routes.editCalls += 1;
              editInput = input;
              throw retryableDownloadError();
            },
          },
        },
      },
    };
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
        setPages: updater => setPages(previous => {
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

    await act(async () => {
      const renderer = TestRenderer.create(<Harness />);
      addRenderer(renderer);
    });
    await waitFor(() => assert.ok(trigger));
    await act(async () => {
      await trigger!(pageState[0], '2:3', [
        'data:image/png;base64,AA==',
        'data:image/png;base64,AQ==',
      ]);
    });
    assert.match(pageState[0].error || '', /download failed/);
    await act(async () => { await sleep(RETRY_WINDOW_MS); });
    assert.equal(routes.editCalls, 1);
    assert.equal(routes.generateCalls, 0);
    assert.equal(routes.generateStreamCalls, 0);
    assert.equal(editInput?.imageAttachmentId, 'reference-attachment-1');
    assert.deepEqual(editInput?.referenceAttachmentIds, ['reference-attachment-2']);
  });
});

test('two CharacterGenerator instances adopt one shared in-flight request and each receive its update', { concurrency: false }, async () => {
  await withIsolatedEnvironment(async addRenderer => {
    const counter = { calls: 0 };
    let resolveImage: ((value: ImageResult) => void) | undefined;
    const hostResult = new Promise<ImageResult>(resolve => { resolveImage = resolve; });
    (globalThis as any).window = {
      mulby: {
        ai: {
          allModels: async () => [{ id: 'test-image-model' }],
          call: async () => ({ content: '' }),
          abort: async () => undefined,
          tokens: { estimate: async () => ({ inputTokens: 0, outputTokens: 0 }) },
          attachments: { upload: async () => ({ attachmentId: 'unused' }), get: async () => null, delete: async () => undefined },
          images: {
            generate: async () => { counter.calls += 1; return hostResult; },
            generateStream: async (_input: unknown, _onChunk: (chunk: unknown) => void) => { counter.calls += 1; return hostResult; },
            edit: async () => hostResult,
          },
        },
      },
    };

    const updatesA: unknown[] = [];
    const updatesB: unknown[] = [];
    const props = {
      characters: [{ name: 'Shared flight', description: 'same asset' }],
      style: 'test style',
      mainCharacterName: 'Shared flight',
      storyMode: 'conflict',
      onConfirm: () => undefined,
      onUsageCallback: () => undefined,
    };
    await act(async () => {
      addRenderer(TestRenderer.create(<CharacterGenerator {...props} onUpdateCharacter={(index, value) => updatesA.push({ index, value })} />));
      addRenderer(TestRenderer.create(<CharacterGenerator {...props} onUpdateCharacter={(index, value) => updatesB.push({ index, value })} />));
    });
    await waitFor(() => assert.equal(counter.calls, 1));
    await act(async () => { resolveImage!({ images: ['aGVsbG8='], tokens: { inputTokens: 0, outputTokens: 0 } }); });
    await waitFor(() => {
      assert.equal(updatesA.length, 1);
      assert.equal(updatesB.length, 1);
    });
    assert.equal(counter.calls, 1);
  });
});
