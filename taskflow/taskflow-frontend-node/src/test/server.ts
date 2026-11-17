import { setupServer } from 'msw/node';

/** One mock server for every test; each test adds the handlers it needs with server.use(). */
export const server = setupServer();

export const api = (path: string) => `http://localhost:8001/api/v1${path}`;
