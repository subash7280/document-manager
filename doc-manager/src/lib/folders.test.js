import { describe as group, expect, test } from 'vitest';
import { flattenTree, subtreeIds } from './folderActions';
import { shouldReport } from './errorReporting';
import { describe } from '../pages/ActivityPage';

const folders = [
  { id: 'b', name: '12th', parentId: 'p' },
  { id: 'p', name: 'Proofs', parentId: null },
  { id: 'a', name: '10th', parentId: 'p' },
  { id: 'm', name: 'Marks', parentId: 'a' },
  { id: 'z', name: 'Bills', parentId: null }
];

group('folder tree', () => {
  test('flattens depth-first, sorted by name (numbers in order)', () => {
    expect(flattenTree(folders).map((r) => `${r.depth}:${r.folder.name}`)).toEqual(['0:Bills', '0:Proofs', '1:10th', '2:Marks', '1:12th']);
  });

  test('a folder subtree includes every level below it', () => {
    expect([...subtreeIds(folders, 'p')].sort()).toEqual(['a', 'b', 'm', 'p']);
    expect([...subtreeIds(folders, 'a')].sort()).toEqual(['a', 'm']);
  });
});

group('activity descriptions', () => {
  test('read like sentences', () => {
    expect(describe({ action: 'DOCUMENT_MOVED', targetName: 'mark.pdf', from: 'My documents', to: '10th' }))
      .toBe('Moved "mark.pdf" from My documents to 10th');
    expect(describe({ action: 'FOLDER_RENAMED', targetName: 'B', from: 'A', to: 'B' })).toBe('Renamed folder "A" to "B"');
    expect(describe({ action: 'SIGNED_IN', targetName: 'Google' })).toBe('Signed in with Google');
    expect(describe({ action: 'FOLDER_CREATED', status: 'FAILURE', targetName: 'Bills' })).toBe('Couldn\'t create folder "Bills"');
  });
});

group('error reports', () => {
  test('only browser-side problems are reported', () => {
    expect(shouldReport(new TypeError('x is undefined'))).toBe(true);
    expect(shouldReport(Object.assign(new Error('Name taken'), { fromServer: true }))).toBe(false);
    expect(shouldReport(Object.assign(new Error('offline'), { code: 'NETWORK' }))).toBe(false);
    expect(shouldReport(Object.assign(new Error('stop'), { code: 'CANCELLED' }))).toBe(false);
  });
});
