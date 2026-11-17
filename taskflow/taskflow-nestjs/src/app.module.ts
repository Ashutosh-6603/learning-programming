import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { ProblemFilter } from './common/http/problem.filter.js';
import { RouteTable } from './common/http/route-table.js';
import { RequestValidationPipe } from './common/validation/request-validation.pipe.js';
import { CoreModule } from './core.module.js';
import { ActivityModule } from './modules/activity/activity.module.js';
import { AttachmentsModule } from './modules/attachments/attachments.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CommentsModule } from './modules/comments/comments.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js';

@Module({
  imports: [
    CoreModule,
    DiscoveryModule,
    HealthModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,
    SearchModule,
    AttachmentsModule,
    RealtimeModule,
    ActivityModule,
  ],
  providers: [
    RouteTable,
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_PIPE, useClass: RequestValidationPipe },
  ],
})
export class AppModule {}
