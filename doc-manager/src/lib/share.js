// ==================================================================
// SHARING HELPERS
// Builds the "share to..." links for each platform. Every link only
// carries the PUBLIC url; private documents never get one (the share
// dialog requires the owner's explicit consent first).
// ==================================================================

const enc = encodeURIComponent;

// Instagram has no website "share link" that can pre-fill a post, so it
// is handled by copying the link instead (see ShareTargets.jsx).
export const SHARE_TARGETS = [
  { id: 'whatsapp', label: 'WhatsApp', brand: '#25d366', build: (url, title) => `https://wa.me/?text=${enc(`${title} ${url}`)}` },
  { id: 'linkedin', label: 'LinkedIn', brand: '#0a66c2', build: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
  { id: 'email', label: 'Email', brand: '#5b6270', build: (url, title) => `mailto:?subject=${enc(title)}&body=${enc(`${title}\n${url}`)}` },
  { id: 'x', label: 'X', brand: '#000000', build: (url, title) => `https://x.com/intent/post?url=${enc(url)}&text=${enc(title)}` },
  { id: 'facebook', label: 'Facebook', brand: '#1877f2', build: (url) => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
  { id: 'telegram', label: 'Telegram', brand: '#229ed9', build: (url, title) => `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}` },
  { id: 'instagram', label: 'Instagram', brand: '#e1306c', build: null }
];

export const shareUrlFor = (targetId, url, title) => {
  const target = SHARE_TARGETS.find((t) => t.id === targetId);
  return target?.build ? target.build(url, title) : null;
};

// The device's own share sheet (phones, Safari, Edge...). It can include
// apps like Instagram when they are installed.
export const canUseWebShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts: the classic copy fallback.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
