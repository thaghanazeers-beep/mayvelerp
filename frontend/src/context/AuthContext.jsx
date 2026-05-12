import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('mayvel_user');
    return saved ? JSON.parse(saved) : null;
  });
  // Super Admins can toggle into "normal mode" — same view a regular admin
  // would see (no Access Control link, no owner-bypass on other teamspaces).
  // Persisted so refresh keeps the same view.
  const [superAdminMode, setSuperAdminMode] = useState(() => {
    const saved = localStorage.getItem('mayvel_superAdminMode');
    return saved === null ? true : saved === 'true';
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('mayvel_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('mayvel_user');
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('mayvel_superAdminMode', String(superAdminMode));
  }, [superAdminMode]);

  const loginUser = (authData) => {
    // Login signature accepts either { user, token } or raw user object (legacy callers).
    if (authData && authData.user) {
      setUser(authData.user);
      if (authData.token) localStorage.setItem('token', authData.token);
    } else {
      setUser(authData);
    }
  };
  const logout = () => {
    setUser(null);
    localStorage.removeItem('token');
    sessionStorage.removeItem('mayvel_originalUser');
    sessionStorage.removeItem('mayvel_originalToken');
  };

  // Effective check used everywhere: only true when the user IS a super admin
  // AND has the toggle set to ON. Components should call this instead of
  // checking `user.isSuperAdmin` directly so the normal-mode switch works.
  const isSuperAdminActive = !!(user?.isSuperAdmin && superAdminMode);

  // Impersonation: SuperAdmin "views as" another user. We stash the original
  // user + token in sessionStorage (not localStorage — auto-cleared on tab
  // close so we don't get stuck impersonating). Reverting restores them.
  const originalUserJSON = typeof window !== 'undefined' ? sessionStorage.getItem('mayvel_originalUser') : null;
  const impersonating = originalUserJSON ? JSON.parse(originalUserJSON) : null;

  const impersonateAs = (targetUser, targetToken) => {
    // Save original only the first time; if already impersonating, don't overwrite.
    if (!sessionStorage.getItem('mayvel_originalUser')) {
      sessionStorage.setItem('mayvel_originalUser', JSON.stringify(user));
      sessionStorage.setItem('mayvel_originalToken', localStorage.getItem('token') || '');
    }
    setUser(targetUser);
    if (targetToken) localStorage.setItem('token', targetToken);
  };
  const revertImpersonation = () => {
    const origUser  = sessionStorage.getItem('mayvel_originalUser');
    const origToken = sessionStorage.getItem('mayvel_originalToken');
    if (origUser)  setUser(JSON.parse(origUser));
    if (origToken) localStorage.setItem('token', origToken);
    sessionStorage.removeItem('mayvel_originalUser');
    sessionStorage.removeItem('mayvel_originalToken');
  };

  return (
    <AuthContext.Provider value={{
      user, loginUser, logout,
      superAdminMode, setSuperAdminMode, isSuperAdminActive,
      impersonating, impersonateAs, revertImpersonation,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
