import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';

const TTL_SECONDS = 300;
const key = (projectId: string) => `cache:board:${projectId}`;

/** Cache-aside: read through on a miss, delete after every write that changes the board. */
@Injectable()
export class BoardCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async getOrLoad<T>(projectId: string, load: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key(projectId));
    if (cached !== null) return JSON.parse(cached) as T;
    const value = await load();
    await this.redis.set(key(projectId), JSON.stringify(value), 'EX', TTL_SECONDS);
    return value;
  }

  async invalidate(projectId: string): Promise<void> {
    await this.redis.del(key(projectId));
  }
}
