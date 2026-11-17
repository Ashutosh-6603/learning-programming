import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by the requestContext middleware; pino-http reuses it for every log line. */
    id: string;
    /** Set by the JWT strategy once a request is authenticated. */
    user?: { id: string };
  }
}
