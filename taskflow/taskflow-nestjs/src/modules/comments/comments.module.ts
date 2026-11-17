import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../../database/entities/comment.entity.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { PublisherModule } from '../realtime/publisher.module.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Comment]), AccessModule, ActivityModule, PublisherModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
