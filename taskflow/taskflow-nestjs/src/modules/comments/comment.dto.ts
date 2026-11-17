import { IsString, Length } from 'class-validator';
import type { Comment } from '../../database/entities/comment.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export class CommentBodyDto {
  @IsString()
  @Length(1, 5000)
  body: string;
}

export class CommentDto {
  id: string;
  taskId: string;
  author: UserSummaryDto;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const toComment = (c: Comment): CommentDto => ({
  id: c.id,
  taskId: c.taskId,
  author: toUserSummary(c.author),
  body: c.body,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
