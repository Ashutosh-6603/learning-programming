import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { UsersModule } from '../users/users.module.js';
import { Presence } from './presence.service.js';
import { PublisherModule } from './publisher.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { Tickets } from './tickets.service.js';

@Module({
  imports: [AccessModule, UsersModule, PublisherModule],
  controllers: [RealtimeController],
  providers: [Tickets, Presence, RealtimeGateway],
})
export class RealtimeModule {}
