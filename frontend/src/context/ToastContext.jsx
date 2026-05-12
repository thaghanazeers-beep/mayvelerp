import { createContext, useCallback, useContext, useState } from 'react';
import './ToastContext.css';

// Lightweight app-wide toast system. Any component can call
// `const toast = useToast(); toast.success('Saved')` and a small banner
// fades in/out top-right. Use `.error(msg)` for the red variant, `.info(msg)`
// for the neutral one. Defaults to 4s display.

const ToastContext = createContext({ success: () => {}, error: () => {}, info: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((tone, message, ttl = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, tone, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ttl);
  }, []);

  const api = {
    success: (msg, ttl) => push('success', msg, ttl),
    error:   (msg, ttl) => push('error',   msg, ttl ?? 6000),
    info:    (msg, ttl) => push('info',    msg, ttl),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast-pill toast-pill-${t.tone}`}>
            <span className="toast-pill-icon">{t.tone === 'success' ? '✓' : t.tone === 'error' ? '✕' : 'i'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
