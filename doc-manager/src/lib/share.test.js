import { describe, expect, test } from 'vitest';
import { SHARE_TARGETS, shareUrlFor } from './share';

const url = 'https://docs.example.com/s/AbC_123-xyz';
const title = 'Q3 report & notes.pdf';

describe('share links', () => {
  test('every platform with a share URL encodes the link', () => {
    for (const target of SHARE_TARGETS.filter((t) => t.build)) {
      const href = shareUrlFor(target.id, url, title);
      expect(href, target.id).toContain(encodeURIComponent(url));
      expect(href, target.id).not.toContain(' ');
    }
  });

  test('platform URLs', () => {
    expect(shareUrlFor('whatsapp', url, title)).toBe(`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`);
    expect(shareUrlFor('linkedin', url, title)).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
    expect(shareUrlFor('email', url, title)).toMatch(/^mailto:\?subject=Q3%20report%20%26%20notes\.pdf&body=/);
  });

  test('Instagram has no prefilled web link (handled by copying)', () => {
    expect(shareUrlFor('instagram', url, title)).toBeNull();
  });
});
