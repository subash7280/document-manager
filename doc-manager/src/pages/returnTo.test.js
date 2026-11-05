import { expect, test } from 'vitest';
import { safeReturnTo } from './SignInPage';

test('returnTo only allows same-site paths', () => {
  expect(safeReturnTo('/upload')).toBe('/upload');
  expect(safeReturnTo('/d/abc?print=1')).toBe('/d/abc?print=1');
  const backslash = String.fromCharCode(92);
  for (const bad of ['//evil.com', `/${backslash}evil.com`, `/${backslash}/evil.com`, 'https://evil.com', 'javascript:alert(1)', null]) {
    expect(safeReturnTo(bad), String(bad)).toBe('/');
  }
});
