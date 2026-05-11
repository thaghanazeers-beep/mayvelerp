import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getTeamspaces } from '../api';

const TeamspaceContext = createContext();

export function TeamspaceProvider({ children }) {
  const { user } = useAuth();
  const [activeTeamspaceId, setActiveTeamspaceId] = useState(() => {
    const val = localStorage.getItem('mayvel_activeTeamspace');
    return (val === 'undefined' || val === 'null' || !val) ? '' : val;
  });
  
  const [teamspaces, setTeamspaces] = useState([]);

  const refreshTeamspaces = async () => {
    if (!user) return;
    try {
      const res = await getTeamspaces();
      setTeamspaces(res.data);
      const validIds = res.data.map(ts => ts._id);
      if (res.data.length > 0 && (!activeTeamspaceId || !validIds.includes(activeTeamspaceId))) {
        setActiveTeamspaceId(res.data[0]._id);
      }
    } catch (err) {
      console.error('Failed to fetch teamspaces', err);
    }
  };

  useEffect(() => {
    refreshTeamspaces();
  }, [user]);

  useEffect(() => {
    localStorage.setItem('mayvel_activeTeamspace', activeTeamspaceId || '');
  }, [activeTeamspaceId]);

  return (
    <TeamspaceContext.Provider value={{ activeTeamspaceId, setActiveTeamspaceId, teamspaces, refreshTeamspaces }}>
      {children}
    </TeamspaceContext.Provider>
  );
}

export function useTeamspace() {
  return useContext(TeamspaceContext);
}
