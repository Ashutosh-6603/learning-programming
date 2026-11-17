import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';
import type { TicketDto } from './ticket.dto.js';

const TTL_SECONDS = 30;
const key = (ticket: string) => `ws:ticket:${ticket}`;

/** Browsers can't send Authorization on a WebSocket handshake, so they trade a JWT for a ticket. */
@Injectable()
export class Tickets {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(userId: string): Promise<TicketDto> {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(key(ticket), userId, 'EX', TTL_SECONDS);
    return { ticket, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString() };
  }

  /** Single use: GETDEL reads and deletes atomically. */
  redeem(ticket: string): Promise<string | null> {
    return this.redis.getdel(key(ticket));
  }
}
