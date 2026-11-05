import React from 'react';
import toast from 'react-hot-toast';
import { Camera, Check, Copy, Mail, MessageCircle, Send, Share2 } from 'lucide-react';
import { SHARE_TARGETS, canUseWebShare, copyText, shareUrlFor } from '../lib/share';
import Button from './Button';

// Simple marks for each platform (letters or generic icons, in the
// platform's color) - always shown together with the platform's name.
const MARKS = {
  whatsapp: <MessageCircle size={20} aria-hidden="true" />,
  linkedin: <span aria-hidden="true">in</span>,
  email: <Mail size={20} aria-hidden="true" />,
  x: <span aria-hidden="true">X</span>,
  facebook: <span aria-hidden="true">f</span>,
  telegram: <Send size={19} aria-hidden="true" />,
  instagram: <Camera size={20} aria-hidden="true" />
};

// ==================================================================
// SHARE TARGETS - copy link, the device share sheet, and platforms.
// Only ever receives a PUBLIC url.
// ==================================================================
export default function ShareTargets({ url, title }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async (message = 'Link copied') => {
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(message, { duration: message.length > 40 ? 6000 : 2500 });
    } else {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, url });
    } catch (err) {
      if (err?.name !== 'AbortError') toast.error('Sharing is not available here. Copy the link instead.');
    }
  };

  const openTarget = (id) => {
    if (id === 'instagram') {
      // Instagram cannot be pre-filled from a website: copy + explain.
      return copy('Link copied. Paste it into an Instagram story link sticker, your bio or a direct message.');
    }
    const href = shareUrlFor(id, url, title);
    if (id === 'email') {
      window.location.href = href;
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="d-grid gap-3">
      <div>
        <label className="ui-label" htmlFor="share-link">Public link</label>
        <div className="share-link-row">
          <input id="share-link" className="ui-input" value={url} readOnly onFocus={(e) => e.target.select()} />
          <Button variant="primary" icon={copied ? Check : Copy} onClick={() => copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {canUseWebShare() && (
        <Button variant="outline" icon={Share2} onClick={nativeShare} block>
          Share with an app on this device…
        </Button>
      )}

      <div>
        <div className="ui-label">Share to</div>
        <div className="share-grid">
          {SHARE_TARGETS.map((target) => (
            <button key={target.id} type="button" className="share-target" onClick={() => openTarget(target.id)}>
              <span className="share-target-icon" style={{ '--brand': target.brand }}>{MARKS[target.id]}</span>
              {target.label}
            </button>
          ))}
        </div>
        <p className="ui-field-hint mb-0">
          Instagram doesn't support sharing links from websites, so we copy the link for you to paste.
        </p>
      </div>
    </div>
  );
}
