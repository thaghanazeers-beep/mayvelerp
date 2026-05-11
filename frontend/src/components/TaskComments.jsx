import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getTaskComments, postTaskComment, deleteTaskComment, signedFileUrl } from '../api';

// Render comment body with @mentions highlighted.
function renderBody(body) {
  const parts = body.split(/(@[\w.\-' ]+?(?=[\s.,!?;:]|$))/g);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <strong key={i} style={{ color: 'var(--primary-light)' }}>{p}</strong>
      : <span key={i}>{p}</span>
  );
}

export default function TaskComments({ taskId, teamMembers = [] }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // @-mention picker state
  const [mentionIdx, setMentionIdx] = useState(-1);    // start position of '@' or -1
  const [mentionMatches, setMentionMatches] = useState([]);
  const taRef = useRef(null);

  const reload = async () => {
    try { const r = await getTaskComments(taskId); setComments(r.data || []); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  };
  useEffect(() => { if (taskId) reload(); /* eslint-disable-next-line */ }, [taskId]);

  const onChange = (e) => {
    const val = e.target.value;
    setDraft(val);
    // Detect '@token' at the cursor for autocomplete
    const cur = e.target.selectionStart;
    const upToCursor = val.slice(0, cur);
    const m = upToCursor.match(/(?:^|\s)@([\w.\-' ]*)$/);
    if (m) {
      const token = m[1].toLowerCase();
      setMentionIdx(cur - m[1].length);
      setMentionMatches(teamMembers.filter(tm => tm.name?.toLowerCase().includes(token)).slice(0, 6));
    } else {
      setMentionIdx(-1); setMentionMatches([]);
    }
  };
  const insertMention = (name) => {
    if (mentionIdx < 0 || !taRef.current) return;
    const before = draft.slice(0, mentionIdx);
    const after  = draft.slice(taRef.current.selectionStart);
    const next   = before + name + ' ' + after;
    setDraft(next);
    setMentionIdx(-1); setMentionMatches([]);
    requestAnimationFrame(() => {
      taRef.current.focus();
      const pos = (before + name + ' ').length;
      taRef.current.setSelectionRange(pos, pos);
    });
  };

  const submit = async (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError('');
    try {
      await postTaskComment(taskId, text);
      setDraft('');
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && mentionMatches.length) {
      setMentionMatches([]); setMentionIdx(-1);
    }
  };

  const removeComment = async (id) => {
    if (!confirm('Delete this comment?')) return;
    try { await deleteTaskComment(taskId, id); await reload(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  };

  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 12px', color: 'var(--text)' }}>
        💬 Comments {comments.length > 0 && <span className="muted" style={{ fontSize: '0.78rem', marginLeft: 6 }}>({comments.length})</span>}
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {comments.map(c => {
          const author = teamMembers.find(m => m.name === c.authorName);
          const canDelete = c.authorName === user?.name || user?.role === 'Admin';
          return (
            <div key={c._id} style={{
              display: 'flex', gap: 10, padding: 10,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600, flexShrink: 0,
                overflow: 'hidden',
              }}>
                {author?.profilePictureUrl
                  ? <img src={signedFileUrl(author.profilePictureUrl)} alt={c.authorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (c.authorName || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{c.authorName}</strong>
                  <span className="muted" style={{ fontSize: '0.7rem' }}>
                    {new Date(c.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  {canDelete && (
                    <button
                      style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}
                      onClick={() => removeComment(c._id)}
                      title="Delete comment"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text)', marginTop: 2, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {renderBody(c.body)}
                </div>
              </div>
            </div>
          );
        })}
        {comments.length === 0 && <div className="muted" style={{ fontSize: '0.78rem', padding: '8px 4px' }}>No comments yet — start the conversation.</div>}
      </div>

      <form onSubmit={submit} style={{ marginTop: 12, position: 'relative' }}>
        <textarea
          ref={taRef}
          className="input"
          rows={2}
          placeholder="Write a comment… use @name to mention.  Cmd+Enter to send."
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          style={{ resize: 'vertical', minHeight: 60 }}
          disabled={busy}
        />
        {mentionMatches.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 12,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            minWidth: 200, zIndex: 5, padding: 4,
          }}>
            {mentionMatches.map(m => (
              <button
                key={m._id}
                type="button"
                onClick={() => insertMention(m.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '6px 10px',
                  background: 'transparent', border: 'none',
                  color: 'var(--text)', fontSize: '0.8rem',
                  cursor: 'pointer', borderRadius: 4, textAlign: 'left',
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <span>{m.profilePictureUrl ? '🙂' : '👤'}</span>
                <strong>{m.name}</strong>
                <span className="muted" style={{ fontSize: '0.7rem' }}>{m.email}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span className="muted" style={{ fontSize: '0.7rem' }}>{error && <span style={{ color: 'var(--accent-red)' }}>{error}</span>}</span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draft.trim()}>
            {busy ? 'Sending…' : 'Comment'}
          </button>
        </div>
      </form>
    </div>
  );
}
