import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { createPrisma } from './infra/db.js';
import { createLogger } from './infra/logger.js';
import { createRedis } from './infra/redis.js';
import { Storage } from './infra/storage.js';
import { createQueue, Jobs } from './jobs/queue.js';
import { ActivityRepository } from './modules/activity/activity.repository.js';
import { ActivityService } from './modules/activity/activity.service.js';
import { AttachmentsService } from './modules/attachments/attachments.service.js';
import { AccessTokens } from './modules/auth/access-tokens.js';
import { AuthService } from './modules/auth/auth.service.js';
import { RefreshTokens } from './modules/auth/refresh-tokens.js';
import { CommentsService } from './modules/comments/comments.service.js';
import { BoardCache } from './modules/projects/board-cache.js';
import { ColumnsService } from './modules/projects/columns.service.js';
import { ProjectsService } from './modules/projects/projects.service.js';
import { Presence } from './modules/realtime/presence.js';
import { RealtimePublisher } from './modules/realtime/publisher.js';
import { Tickets } from './modules/realtime/tickets.js';
import { SearchService } from './modules/search/search.service.js';
import { TasksService } from './modules/tasks/tasks.service.js';
import { UsersRepository } from './modules/users/users.repository.js';
import { Access } from './modules/workspaces/access.js';
import { InvitationsService } from './modules/workspaces/invitations.service.js';
import { MembersService } from './modules/workspaces/members.service.js';
import { WorkspacesService } from './modules/workspaces/workspaces.service.js';

export interface Infra {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  redis: Redis;
  storage: Storage;
  queue: Queue;
}

export function createInfra(config: Config): Infra {
  const redis = createRedis(config.REDIS_URL);
  return {
    config,
    logger: createLogger(config),
    prisma: createPrisma(config.DATABASE_URL),
    redis,
    storage: new Storage(config),
    queue: createQueue(redis),
  };
}

export async function closeInfra(infra: Infra): Promise<void> {
  await infra.queue.close();
  await infra.prisma.$disconnect();
  infra.redis.disconnect();
}

/** Manual dependency injection: the one place that knows how everything is wired. */
export function createServices(infra: Infra) {
  const { config, prisma, redis } = infra;
  const users = new UsersRepository(prisma);
  const activity = new ActivityRepository();
  const access = new Access(prisma);
  const jobs = new Jobs(infra.queue);
  const realtime = new RealtimePublisher(redis);
  const boardCache = new BoardCache(redis);
  const accessTokens = new AccessTokens(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SECONDS);

  return {
    users,
    access,
    accessTokens,
    realtime,
    tickets: new Tickets(redis),
    presence: new Presence(redis, users),
    auth: new AuthService(
      users,
      accessTokens,
      new RefreshTokens(redis, config.REFRESH_TOKEN_TTL_SECONDS),
    ),
    workspaces: new WorkspacesService(prisma, access, activity, jobs),
    members: new MembersService(prisma, access, activity),
    invitations: new InvitationsService(prisma, access, activity, jobs),
    projects: new ProjectsService(prisma, access, activity, boardCache, jobs),
    columns: new ColumnsService(prisma, access, activity, boardCache, realtime),
    tasks: new TasksService(prisma, access, activity, boardCache, realtime, jobs),
    comments: new CommentsService(prisma, access, activity, realtime),
    attachments: new AttachmentsService(prisma, access, activity, infra.storage, jobs),
    activity: new ActivityService(prisma, access, activity),
    search: new SearchService(prisma, access),
  };
}

export type Services = ReturnType<typeof createServices>;
