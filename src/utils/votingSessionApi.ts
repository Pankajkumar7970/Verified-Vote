import axios from 'axios';

export const SESSION_TOKEN_KEY = 'vv_session_token';

/** Axios client that only ever sends the voting-session JWT (never the voter portal token). */
export function createVotingSessionApi() {
  const api = axios.create();
  api.interceptors.request.use((config) => {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  return api;
}

export function saveVotingSessionToken(token: string) {
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearVotingSessionToken() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}
