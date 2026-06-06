import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { isStoredVoterTokenUsable } from '../utils/voterToken';

function isVotingSessionApiUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('/api/session/') || url.includes('/api/vote/');
}

interface VoterContextType {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const VoterContext = createContext<VoterContextType | undefined>(undefined);

function readStoredVoterToken(): string | null {
  const stored = localStorage.getItem('voter_token');
  if (!stored) return null;
  if (!isStoredVoterTokenUsable(stored)) {
    localStorage.removeItem('voter_token');
    return null;
  }
  return stored;
}

export function VoterProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredVoterToken());

  const logout = useCallback(() => {
    localStorage.removeItem('voter_token');
    setToken(null);
  }, []);

  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use(
      (config) => {
        const active = readStoredVoterToken();
        if (
          active &&
          config.url &&
          !config.url.startsWith('/api/admin') &&
          !isVotingSessionApiUrl(config.url)
        ) {
          config.headers['Authorization'] = `Bearer ${active}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const url = error.config?.url || '';
        if (error.response?.status === 401 && url.includes('/api/voter')) {
          localStorage.removeItem('voter_token');
          setToken(null);
          if (
            typeof window !== 'undefined' &&
            !window.location.pathname.startsWith('/vote')
          ) {
            window.location.replace('/');
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  const login = (newToken: string) => {
    localStorage.setItem('voter_token', newToken);
    setToken(newToken);
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
