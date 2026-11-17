import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PublisherModule } from '../realtime/publisher.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, WorkspaceMember]),
    AccessModule,
    ActivityModule,
    JobsModule,
    // For BoardCache, which ProjectsModule exports.
    ProjectsModule,
    PublisherModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
