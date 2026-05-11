import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendChat } from '../api';
import { useTeamspace } from '../context/TeamspaceContext';
import './AiChat.css';

const STORAGE_KEY = 'ai_chat_history_v1';
const SUGGESTIONS = [
  'Show me last week\'s data for Seyo project',
  'Who has the highest cost rate this month?',
  'How does the project loss model work?',
  'List all pending plan approvals',
  'What tasks did Suha complete this month?',
  'Explain how weekly slice approval works',
];

export default function AiChat({ open, onClose }) {
  const { activeTeamspaceId } = useTeamspace();
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  });
  const [input, setInput]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const scrollRef             = useRef(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); }, [messages]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Esc closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && open) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const send = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setError('');
    const userMsg = { role: 'user', text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setBusy(true);
    try {
      const r = await sendChat(updated, activeTeamspaceId);
      const reply = { role: 'model', text: r.data.reply, toolCalls: r.data.toolCalls };
      setMessages([...updated, reply]);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      // Roll back the user message? No — keep it so they can retry.
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = () => {
    if (!messages.length) return;
    if (!confirm('Clear chat history?')) return;
    setMessages([]);
    setError('');
  };

  return (
    <>
      {open && <div className="ai-chat-backdrop" onClick={onClose} />}
      <aside className={`ai-chat-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <header className="ai-chat-head">
          <div>
            <h3>✨ AI Assistant</h3>
            <p className="muted">Ask anything about your tasks, plans, P&L, or how the system works.</p>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {messages.length > 0 && (
              <button className="btn-icon" title="Clear history" onClick={clearHistory}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            )}
            <button className="btn-icon" title="Close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </header>

        <div className="ai-chat-body" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="ai-chat-empty">
              <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
              <p>Ask me anything about Mayvel Task — I have access to your live data and the product docs.</p>
              <div className="ai-chat-suggestions">
                <div className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Try one of these</div>
                {SUGGESTIONS.map(s => (
                  <button key={s} className="ai-chat-suggestion" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`ai-chat-msg ai-chat-msg-${m.role}`}>
                <div className="ai-chat-msg-bubble">
                  {m.role === 'user' ? (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  )}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <details className="ai-chat-tools">
                      <summary>🔧 Used {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''}: {m.toolCalls.map(t => t.name).join(', ')}</summary>
                      <pre>{JSON.stringify(m.toolCalls, null, 2)}</pre>
                    </details>
                  )}
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="ai-chat-msg ai-chat-msg-model">
              <div className="ai-chat-msg-bubble ai-chat-typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
          {error && (
            <div className="ai-chat-error">
              {error}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => send(messages[messages.length - 1]?.text)}>Retry</button>
            </div>
          )}
        </div>

        <form
          className="ai-chat-input"
          onSubmit={(e) => { e.preventDefault(); send(); }}
        >
          <textarea
            rows={1}
            placeholder="Ask anything…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); send();
              }
            }}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !input.trim()}>
            {busy ? '...' : 'Send'}
          </button>
        </form>
      </aside>
    </>
  );
}
