import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { unauthorized } from '../lib/problem.js';

/** Reads a Bearer token if there is one. A bad token is a 401; no token is decided later. */
export const authenticate: onRequestAsyncHookHandler = async (request) => {
  if (!request.headers.authorization?.startsWith('Bearer ')) return;
  try {
    const { sub } = await request.jwtVerify<{ sub: string }>();
    request.userId = sub;
  } catch {
    throw unauthorized('Invalid or expired access token');
  }
};

export const requireAuth: onRequestAsyncHookHandler = async (request) => {
  if (request.userId === null) throw unauthorized();
};

/** The authenticated user's id. Only call behind `requireAuth`. */
export function userIdOf(request: FastifyRequest): string {
  if (request.userId === null) throw unauthorized();
  return request.userId;
}
