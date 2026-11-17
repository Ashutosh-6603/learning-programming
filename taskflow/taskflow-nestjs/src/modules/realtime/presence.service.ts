import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';
import { toUserSummary, type UserSummaryDto } from '../users/user.dto.js';
import { UsersService } from '../users/users.service.js';

const STALE_AFTER_MS = 60_000;
const KEY_TTL_SECONDS = 300;
const key = (projectId: string) => `presence:project:${projectId}`;
const member = (userId: string, connectionId: string) => `${userId}:${connectionId}`;

/**
 * Sorted set per project: member = "userId:connectionId", score = last seen (ms).
 * One user with two tabs has two members, so closing one tab doesn't hide them.
 */
@Injectable()
export class Presence {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly users: UsersService,
  ) {}

  async touch(
    projectId: string,
    userId: string,
    connectionId: string,
    now = Date.now(),
  ): Promise<void> {
    await this.redis
      .multi()
      .zadd(key(projectId), now, member(userId, connectionId))
      .expire(key(projectId), KEY_TTL_SECONDS)
      .exec();
  }

  async leave(projectId: string, userId: string, connectionId: string): Promise<void> {
    await this.redis.zrem(key(projectId), member(userId, connectionId));
  }

  async online(projectId: string, now = Date.now()): Promise<UserSummaryDto[]> {
    await this.redis.zremrangebyscore(key(projectId), '-inf', String(now - STALE_AFTER_MS));
    const members = await this.redis.zrange(key(projectId), '0', '-1');
    const userIds = [...new Set(members.map((m) => m.slice(0, m.indexOf(':'))))];
    if (userIds.length === 0) return [];
    const users = await this.users.findByIds(userIds);
    return users.map(toUserSummary).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}
