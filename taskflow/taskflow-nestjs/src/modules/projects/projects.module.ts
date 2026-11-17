import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { PublisherModule } from '../realtime/publisher.module.js';
import { BoardCache } from './board-cache.js';
import { ColumnsService } from './columns.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, BoardColumn, Task]),
    AccessModule,
    ActivityModule,
    JobsModule,
    PublisherModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ColumnsService, BoardCache],
  exports: [BoardCache],
})
export class ProjectsModule {}
