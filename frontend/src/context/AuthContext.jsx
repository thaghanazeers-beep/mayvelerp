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
    localStorage.removeItem('mayvel_originalUser');
    localStorage.removeItem('mayvel_originalToken');
    sessionStorage.removeItem('mayvel_originalUser');
    sessionStorage.removeItem('mayvel_originalToken');
  };

  // Effective check used everywhere: only true when the user IS a super admin
  // AND has the toggle set to ON. Components should call this instead of
  // checking `user.isSuperAdmin` directly so the normal-mode switch works.
  const isSuperAdminActive = !!(user?.isSuperAdmin && superAdminMode);

  // Impersonation: SuperAdmin "views as" another user. The original user is
  // persisted to **localStorage** so a tab close doesn't strand the SuperAdmin
  // in the impersonated identity (which the View-as banner can't help with —
  // the banner only renders for SuperAdmins, and the impersonated user isn't
  // one). Reverting restores the original session.
  const originalUserJSON = typeof window !== 'undefined' ? localStorage.getItem('mayvel_originalUser') : null;
  const impersonating = originalUserJSON ? JSON.parse(originalUserJSON) : null;

  const impersonateAs = (targetUser, targetToken) => {
    if (!localStorage.getItem('mayvel_originalUser')) {
      localStorage.setItem('mayvel_originalUser', JSON.stringify(user));
      localStorage.setItem('mayvel_originalToken', localStorage.getItem('token') || '');
    }
    setUser(targetUser);
    if (targetToken) localStorage.setItem('token', targetToken);
  };
  const revertImpersonation = () => {
    const origUser  = localStorage.getItem('mayvel_originalUser');
    const origToken = localStorage.getItem('mayvel_originalToken');
    if (origUser)  setUser(JSON.parse(origUser));
    if (origToken) localStorage.setItem('token', origToken);
    localStorage.removeItem('mayvel_originalUser');
    localStorage.removeItem('mayvel_originalToken');
    // Legacy: clear any stale sessionStorage entries from older versions.
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
