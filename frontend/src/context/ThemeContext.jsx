import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { updateUser } from '../api';

const ThemeContext = createContext(null);

// The brand default that theme.css ships with. Used so "Reset to default"
// clears the user's override and falls back to the CSS value.
const DEFAULT_PRIMARY = '#b8ff03';

// Source of truth for theme/accent:
//   - logged in  → user.themeMode / user.accentColor on the User document
//                  (PUT /api/users/:id on every change; cached user is updated
//                  via loginUser so a refresh reads the same value)
//   - logged out → localStorage, so the login/signup screens still respect
//                  the last-used theme and don't flash the default
export function ThemeProvider({ children }) {
  const { user, loginUser } = useAuth();

  const [theme, setTheme] = useState(() => {
    return user?.themeMode || localStorage.getItem('mayvel_theme') || 'dark';
  });
  const [primaryColor, setPrimaryColorState] = useState(() => {
    return user?.accentColor || localStorage.getItem('mayvel_primary') || '';
  });

  // Whenever the active user changes (login, refresh, impersonate, revert)
  // pull the server-stored prefs in. The fields default-on-undefined so an old
  // user document without these keys just keeps the current/local values.
  useEffect(() => {
    if (!user) return;
    if (user.themeMode)   setTheme(user.themeMode);
    if (typeof user.accentColor === 'string') setPrimaryColorState(user.accentColor);
  }, [user?._id, user?.themeMode, user?.accentColor]);

  // Apply theme to <html data-theme>, and keep a localStorage copy so the
  // login screen / pre-hydration paint doesn't flash the wrong theme.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mayvel_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (primaryColor) {
      document.documentElement.style.setProperty('--color-primary', primaryColor);
      localStorage.setItem('mayvel_primary', primaryColor);
    } else {
      document.documentElement.style.removeProperty('--color-primary');
      localStorage.removeItem('mayvel_primary');
    }
  }, [primaryColor]);

  // Debounced server save. The <input type="color"> picker fires onChange on
  // every step of the colour wheel — without a debounce that's dozens of PUTs.
  const saveTimer = useRef(null);
  const persistToServer = (patch) => {
    if (!user?._id) return;  // anonymous: localStorage-only
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await updateUser(user._id, patch);
        loginUser({ ...user, ...r.data });
      } catch (e) {
        console.warn('Theme save failed:', e?.response?.data?.error || e.message);
      }
    }, 350);
  };

  const setPrimaryColor = (hex) => {
    const v = hex || '';
    setPrimaryColorState(v);
    persistToServer({ accentColor: v });
  };
  const resetPrimaryColor = () => {
    setPrimaryColorState('');
    persistToServer({ accentColor: '' });
  };
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    persistToServer({ themeMode: next });
  };

  return (
    <ThemeContext.Provider value={{
      theme, toggleTheme,
      primaryColor, setPrimaryColor, resetPrimaryColor,
      defaultPrimary: DEFAULT_PRIMARY,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
