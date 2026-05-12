import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat } from '../api';
import { useTeamspace } from '../context/TeamspaceContext';
import './AiChatPage.css';

const STORAGE_KEY = 'ai_chat_conversations_v1';

const SUGGESTIONS = [
  { icon: '📊', text: 'Show me last week\'s data for Seyo project' },
  { icon: '💰', text: 'Who has the highest cost rate this month?' },
  { icon: '📚', text: 'Explain the project loss model' },
  { icon: '✅', text: 'List all pending plan approvals' },
  { icon: '👤', text: 'What tasks did Suha complete this month?' },
  { icon: '⏱',  text: 'How does weekly slice approval work?' },
];

const newId = () => 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
const titleFromText = (text) => {
  const t = (text || 'New chat').trim().replace(/\s+/g, ' ');
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
};

const groupByDate = (conversations) => {
  const now = Date.now();
  const ONE_DAY = 86400000;
  const groups = { today: [], yesterday: [], week: [], earlier: [] };
  for (const c of conversations) {
    const age = now - new Date(c.updatedAt).getTime();
    if (age < ONE_DAY)         groups.today.push(c);
    else if (age < 2 * ONE_DAY) groups.yesterday.push(c);
    else if (age < 7 * ONE_DAY) groups.week.push(c);
    else                        groups.earlier.push(c);
  }
  return groups;
};

export default function AiChatPage() {
  const navigate = useNavigate();
  const { activeTeamspaceId } = useTeamspace();

  const [store, setStore] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        conversations: Array.isArray(raw.conversations) ? raw.conversations : [],
        activeId: raw.activeId || null,
      };
    } catch { return { conversations: [], activeId: null }; }
  });
  const [input, setInput]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuId, setMenuId] = useState(null);     // which row's "..." menu is open
  const scrollRef = useRef(null);
  const menuRef = useRef(null);
  // Holds the close-fn of the active stream so we can abort on unmount or
  // when the user navigates to a different conversation mid-response.
  const streamCloserRef = useRef(null);
  const abortStream = () => {
    try { streamCloserRef.current?.(); } catch {}
    streamCloserRef.current = null;
  };
  useEffect(() => () => abortStream(), []); // clean up on unmount

  // Persist on every change
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }, [store]);

  // Scroll to bottom on new messages
  const active = store.conversations.find(c => c.id === store.activeId);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [active?.messages?.length, busy]);

  // Close any open row menu on outside click
  useEffect(() => {
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuId(null); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const messages = active?.messages || [];

  // ─── Conversation actions ───
  const newChat = () => {
    abortStream();              // don't keep streaming tokens into the old chat
    setBusy(false);
    setStore(s => ({ ...s, activeId: null }));
    setInput('');
    setError('');
    setMenuId(null);
  };
  const switchTo = (id) => {
    abortStream();
    setBusy(false);
    setStore(s => ({ ...s, activeId: id }));
    setError('');
  };
  const deleteChat = (id) => {
    if (!confirm('Delete this chat?')) return;
    setStore(s => ({
      conversations: s.conversations.filter(c => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
    setMenuId(null);
  };
  const startRename = (c) => { setRenameId(c.id); setRenameValue(c.title); setMenuId(null); };
  const commitRename = () => {
    if (!renameValue.trim()) { setRenameId(null); return; }
    setStore(s => ({
      ...s,
      conversations: s.conversations.map(c => c.id === renameId ? { ...c, title: renameValue.trim() } : c),
    }));
    setRenameId(null);
  };
  const clearAll = () => {
    if (!confirm('Delete ALL chats? This cannot be undone.')) return;
    setStore({ conversations: [], activeId: null });
    setMenuId(null);
  };

  // ─── Send a message ───
  const send = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setError('');

    // If no active conversation, create one and use it
    let convId = store.activeId;
    let convList = store.conversations;
    let nextActive = active;
    if (!convId || !nextActive) {
      const fresh = {
        id: newId(),
        title: titleFromText(text),
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      convId = fresh.id;
      convList = [fresh, ...convList];
      nextActive = fresh;
    }

    const userMsg = { role: 'user', text };
    const optimistic = [...nextActive.messages, userMsg];
    // Seed an empty assistant bubble we'll stream into
    const assistantSeed = { role: 'model', text: '', toolCalls: [] };
    const withSeed = [...optimistic, assistantSeed];
    const updatedList = convList.map(c => c.id === convId
      ? { ...c, messages: withSeed, updatedAt: new Date().toISOString(), title: c.messages.length === 0 ? titleFromText(text) : c.title }
      : c);

    setStore({ conversations: updatedList, activeId: convId });
    setInput('');
    setBusy(true);

    let accumulated = '';
    const toolCalls = [];
    const updateLast = (patch) => {
      setStore(s => ({
        ...s,
        conversations: s.conversations.map(c => {
          if (c.id !== convId) return c;
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1] || {};
          msgs[msgs.length - 1] = { ...last, ...patch };
          return { ...c, messages: msgs, updatedAt: new Date().toISOString() };
        }),
      }));
    };

    // Abort any in-flight stream before starting a new one
    abortStream();
    streamCloserRef.current = streamChat(optimistic, activeTeamspaceId, {
      onToken: ({ text: chunk }) => {
        accumulated += chunk;
        updateLast({ text: accumulated });
      },
      onTool: (tool) => {
        toolCalls.push(tool);
        updateLast({ toolCalls: [...toolCalls] });
      },
      onDone: () => { setBusy(false); streamCloserRef.current = null; },
      onError: ({ message }) => {
        setError(message || 'Stream failed');
        setBusy(false);
        streamCloserRef.current = null;
      },
    });
  };

  // ─── Sidebar list (filtered + grouped) ───
  const filtered = useMemo(() => {
    if (!search.trim()) return store.conversations;
    const q = search.toLowerCase();
    return store.conversations.filter(c =>
      (c.title || '').toLowerCase().includes(q) ||
      c.messages.some(m => (m.text || '').toLowerCase().includes(q))
    );
  }, [store.conversations, search]);
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  const groupSection = (label, items) => items.length === 0 ? null : (
    <div className="aichat-history-group">
      <div className="aichat-history-group-label">{label}</div>
      {items.map(c => (
        <div key={c.id} className={`aichat-history-row ${store.activeId === c.id ? 'active' : ''}`}>
          {renameId === c.id ? (
            <input
              autoFocus
              className="aichat-rename-input"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameId(null); }}
            />
          ) : (
            <button className="aichat-history-title" onClick={() => switchTo(c.id)} title={c.title}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              <span>{c.title}</span>
            </button>
          )}
          <div className="aichat-history-row-actions" ref={menuId === c.id ? menuRef : null}>
            <button className="aichat-row-menu-btn" onClick={() => setMenuId(menuId === c.id ? null : c.id)}>⋯</button>
            {menuId === c.id && (
              <div className="aichat-row-menu">
                <button onClick={() => startRename(c)}>✏️ Rename</button>
                <button onClick={() => deleteChat(c.id)} style={{ color: 'var(--accent-red)' }}>🗑 Delete</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="aichat-page">
      {/* ── History sidebar ── */}
      <aside className={`aichat-sidebar ${sidebarOpen ? '' : 'is-collapsed'}`}>
        <div className="aichat-sidebar-head">
          <button className="btn btn-primary btn-sm aichat-newchat-btn" onClick={newChat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New chat
          </button>
          <button className="btn-icon aichat-collapse-btn" title="Collapse menu" onClick={() => setSidebarOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>

        <div className="aichat-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            placeholder="Search chats…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="aichat-history">
          {filtered.length === 0 ? (
            <div className="aichat-history-empty">{search ? 'No matches' : 'No chats yet'}</div>
          ) : (
            <>
              {groupSection('Today',     groups.today)}
              {groupSection('Yesterday', groups.yesterday)}
              {groupSection('This week', groups.week)}
              {groupSection('Earlier',   groups.earlier)}
            </>
          )}
        </div>

        <div className="aichat-sidebar-foot">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>← Back to app</button>
          {store.conversations.length > 0 && (
            <button className="btn-icon" title="Clear all chats" onClick={clearAll}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          )}
        </div>
      </aside>

      {/* Collapse-toggle floats over content when sidebar is collapsed */}
      {!sidebarOpen && (
        <button className="btn-icon aichat-expand-btn" title="Show menu" onClick={() => setSidebarOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      )}

      {/* ── Main chat area ── */}
      <main className="aichat-main">
        <header className="aichat-main-head">
          <div>
            <h2>{active ? active.title : '✨ AI Assistant'}</h2>
            <p className="muted">
              {active
                ? `${active.messages.length} message${active.messages.length === 1 ? '' : 's'} · ${new Date(active.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
                : 'Ask anything about your data, plans, or how the system works.'}
            </p>
          </div>
        </header>

        <div className="aichat-thread" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="aichat-welcome">
              <div className="aichat-welcome-hero">
                <div className="aichat-welcome-icon">✨</div>
                <h1>How can I help?</h1>
                <p>I have access to your live tasks, projects, plans, time entries, and the full product docs.</p>
              </div>
              <div className="aichat-suggestion-grid">
                {SUGGESTIONS.map(s => (
                  <button key={s.text} className="aichat-suggestion" onClick={() => send(s.text)}>
                    <span className="aichat-suggestion-icon">{s.icon}</span>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`aichat-msg aichat-msg-${m.role}`}>
                <div className="aichat-avatar">{m.role === 'user' ? '🙂' : '✨'}</div>
                <div className="aichat-msg-bubble">
                  {m.role === 'user' ? (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  )}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <details className="aichat-tools">
                      <summary>🔧 Used {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''}: {m.toolCalls.map(t => t.name).join(', ')}</summary>
                      <pre>{JSON.stringify(m.toolCalls, null, 2)}</pre>
                    </details>
                  )}
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="aichat-msg aichat-msg-model">
              <div className="aichat-avatar">✨</div>
              <div className="aichat-msg-bubble aichat-typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
          {error && (
            <div className="aichat-error">
              {error}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => send(messages[messages.length - 1]?.text)}>Retry</button>
            </div>
          )}
        </div>

        <form className="aichat-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            rows={1}
            placeholder="Ask anything…  (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); send();
              }
            }}
            disabled={busy}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
            {busy ? '...' : 'Send'}
          </button>
        </form>
        <p className="aichat-disclaimer">AI can make mistakes. Verify important numbers in the dashboard.</p>
      </main>
    </div>
  );
}
