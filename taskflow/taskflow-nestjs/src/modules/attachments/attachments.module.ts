import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { StorageModule } from '../../infra/storage.module.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attachment]),
    AccessModule,
    ActivityModule,
    JobsModule,
    StorageModule,
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
