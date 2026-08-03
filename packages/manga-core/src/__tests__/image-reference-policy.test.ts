import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectImageReferences,
  type PageReferenceSet,
} from '../services/imageReferencePolicy';

test('preserves current order when references fit', () => {
  const refs: PageReferenceSet = {
    ordered: ['c1', 'c2', 'p1', 's1'],
    characters: ['c1', 'c2'],
    props: ['p1'],
    scenes: ['s1'],
  };

  assert.deepEqual(selectImageReferences(refs, 6), refs.ordered);
});

test('reserves one scene slot while selecting six unique references', () => {
  const refs: PageReferenceSet = {
    ordered: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'p1', 's1'],
    characters: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
    props: ['p1'],
    scenes: ['s1'],
  };

  assert.deepEqual(
    selectImageReferences(refs, 6),
    ['c1', 'c2', 'c3', 'c4', 'c5', 's1'],
  );
});

test('uses character then scene then prop when capacity is one', () => {
  assert.deepEqual(selectImageReferences({
    ordered: ['p1', 's1', 'c1'],
    characters: ['c1'],
    props: ['p1'],
    scenes: ['s1'],
  }, 1), ['c1']);
});

test('dedupes cross-category references before reserving a scene slot', () => {
  assert.deepEqual(selectImageReferences({
    ordered: ['c1', 'shared', 'p1', 's1'],
    characters: ['c1', 'shared'],
    props: ['shared', 'p1'],
    scenes: ['shared', 's1'],
  }, 3), ['c1', 'shared', 's1']);
});

test('normalizes legacy reference arrays without limiting an unknown host', () => {
  assert.deepEqual(
    selectImageReferences([' c1 ', 'c1', '', 'p1', ' p1 ', 's1']),
    ['c1', 'p1', 's1'],
  );
});

test('slices legacy reference arrays only when a limit is known', () => {
  assert.deepEqual(selectImageReferences(['c1', 'p1', 's1'], 2), ['c1', 'p1']);
});
