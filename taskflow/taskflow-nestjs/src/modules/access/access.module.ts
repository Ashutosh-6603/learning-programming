import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Comment } from '../../database/entities/comment.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { AccessService } from './access.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceMember, Project, BoardColumn, Task, Comment, Attachment]),
  ],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
