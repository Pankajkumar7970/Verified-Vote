import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

interface VoterContextType {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const VoterContext = createContext<VoterContextType | undefined>(undefined);

export function VoterProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('voter_token'));

  useEffect(() => {
    // Setup Axios Interceptor for Voter requests
    // We attach token only for non-admin API routes
    const interceptor = axios.interceptors.request.use(
      (config) => {
        if (token && config.url && !config.url.startsWith('/api/admin')) {
          config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return () => axios.interceptors.request.eject(interceptor);
  }, [token]);

  const login = (newToken: string) => {
    localStorage.setItem('voter_token', newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem('voter_token');
    setToken(null);
  };

  return (
    <VoterContext.Provider value={{ token, login, logout, isAuthenticated: !!token }}>
      {children}
    </VoterContext.Provider>
  );
}

export function useVoterAuth() {
  const context = useContext(VoterContext);
  if (context === undefined) {
    throw new Error('useVoterAuth must be used within a VoterProvider');
  }
  return context;
}
