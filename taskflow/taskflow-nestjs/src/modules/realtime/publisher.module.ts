import { Module } from '@nestjs/common';
import { RealtimePublisher } from './realtime.publisher.js';

/**
 * The publishing side of real-time, on its own: services import this to announce changes.
 * The gateway lives in RealtimeModule, so importing the publisher never starts a WebSocket server.
 */
@Module({
  providers: [RealtimePublisher],
  exports: [RealtimePublisher],
})
export class PublisherModule {}
