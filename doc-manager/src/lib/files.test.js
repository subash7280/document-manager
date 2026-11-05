import { describe, expect, test } from 'vitest';
import { MAX_FILE_SIZE, fileAppearance, previewKind, validateFile } from './files';

const file = (name, size) => ({ name, size });

describe('validateFile', () => {
  test('accepts supported files within the limit', () => {
    expect(validateFile(file('report.PDF', 1000))).toBeNull();
    expect(validateFile(file('photo.jpeg', MAX_FILE_SIZE))).toBeNull();
  });
  test('rejects unsupported, empty and oversized files', () => {
    expect(validateFile(file('setup.exe', 10))).toMatch(/not supported/);
    expect(validateFile(file('README', 10))).toMatch(/no extension/);
    expect(validateFile(file('a.txt', 0))).toMatch(/empty/);
    expect(validateFile(file('big.pdf', MAX_FILE_SIZE + 1))).toMatch(/maximum size is 20 MB/);
    expect(validateFile(null)).toMatch(/Choose a file/);
  });
});

describe('presentation', () => {
  test('preview kinds', () => {
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('text/csv')).toBe('text');
    expect(previewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('none');
    expect(previewKind('text/html')).toBe('none');
  });
  test('file appearance', () => {
    expect(fileAppearance('application/pdf', 'a.pdf').tone).toBe('pdf');
    expect(fileAppearance('application/octet-stream', 'budget.xlsx').tone).toBe('sheet');
  });
});
