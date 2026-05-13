import { useState, useEffect } from 'react';
import './PageIntro.css';

/**
 * PageIntro — a one-line "what is this screen for" banner that customers can
 * expand to see what they can do, who normally uses it, and what happens next.
 * Collapsed state is remembered per-page in localStorage so power users only
 * see it once.
 */
export function PageIntro({
  icon = '📘',
  title,
  purpose,
  actor,             // e.g. 'Project Manager' — who normally uses this page
  youCanDo = [],     // string[] — bullets under "What you can do here"
  whatHappensNext = [], // string[] — bullets under "What happens next"
  storageKey,        // optional — if provided, remember collapsed state
  compact = false,
}) {
  const key = storageKey ? `pageIntro:${storageKey}` : null;
  const [open, setOpen] = useState(() => {
    if (!key) return false;
    try { return localStorage.getItem(key) !== 'collapsed'; } catch { return true; }
  });
  useEffect(() => {
    if (!key) return;
    try { localStorage.setItem(key, open ? 'open' : 'collapsed'); } catch {}
  }, [open, key]);

  return (
    <div className={`page-intro ${compact ? 'compact' : ''}`} role="region" aria-label="Page guide">
      <div className="page-intro-icon" aria-hidden>{icon}</div>
      <div className="page-intro-body">
        <div className="page-intro-title">
          <span>{title}</span>
          {actor && <span className="page-intro-actor-tag">For {actor}</span>}
        </div>
        <p className="page-intro-purpose">{purpose}</p>

        {open && (youCanDo.length > 0 || whatHappensNext.length > 0) && (
          <div className="page-intro-details">
            {youCanDo.length > 0 && (
              <div className="page-intro-block">
                <div className="page-intro-block-label">What you can do here</div>
                <ul>{youCanDo.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            {whatHappensNext.length > 0 && (
              <div className="page-intro-block">
                <div className="page-intro-block-label">What happens next</div>
                <ul>{whatHappensNext.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
      {(youCanDo.length > 0 || whatHappensNext.length > 0) && (
        <button
          type="button"
          className="page-intro-toggle"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          {open ? 'Hide guide' : 'Show guide'}
        </button>
      )}
    </div>
  );
}

/**
 * NextStepHint — a small caption rendered near an action button (or status)
 * that tells the user what will happen if they click / what the system is
 * waiting on. Two flavours:
 *   <NextStepHint>moves task to In Review, notifies @Pooja</NextStepHint>
 *   <NextStepHint block>...</NextStepHint>  // forces full-width line under btn
 */
export function NextStepHint({ children, block = false, className = '' }) {
  return (
    <span className={`next-step-hint ${block ? 'block' : ''} ${className}`}>
      {children}
    </span>
  );
}

export default PageIntro;
