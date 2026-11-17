import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitation } from '../../database/entities/invitation.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { User } from '../../database/entities/user.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Workspace } from '../../database/entities/workspace.entity.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { InvitationsService } from './invitations.service.js';
import { MembersService } from './members.service.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember, Invitation, Project, User]),
    AccessModule,
    ActivityModule,
    JobsModule,
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, MembersService, InvitationsService],
})
export class WorkspacesModule {}
