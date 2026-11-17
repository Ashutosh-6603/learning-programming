import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

const TTL_SECONDS = 30;
const key = (ticket: string) => `ws:ticket:${ticket}`;

/** Browsers can't send Authorization on a WebSocket handshake, so they trade a JWT for a ticket. */
export class Tickets {
  constructor(private readonly redis: Redis) {}

  async issue(userId: string) {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(key(ticket), userId, 'EX', TTL_SECONDS);
    return { ticket, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString() };
  }

  /** Single use: GETDEL reads and deletes atomically. */
  redeem(ticket: string): Promise<string | null> {
    return this.redis.getdel(key(ticket));
  }
}
