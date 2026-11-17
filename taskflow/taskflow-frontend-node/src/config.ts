const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8001';

export const config = {
  apiUrl: apiUrl.replace(/\/$/, ''),
  /** Same host as the API, with ws:// or wss:// instead of http(s)://. */
  wsUrl: apiUrl.replace(/\/$/, '').replace(/^http/, 'ws'),
};
