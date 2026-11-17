import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { CommentBodyDto, CommentDto } from './comment.dto.js';
import { CommentsService } from './comments.service.js';

@ApiTags('comments')
@Controller(API_PREFIX)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('tasks/:taskId/comments')
  @ApiPage(CommentDto)
  list(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<CommentDto>> {
    return this.comments.list(taskId, userId, query.limit, query.cursor);
  }

  @Post('tasks/:taskId/comments')
  create(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.create(taskId, userId, dto.body);
  }

  @Patch('comments/:commentId')
  update(
    @IdParam('commentId') commentId: string,
    @CurrentUser() userId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.update(commentId, userId, dto.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  delete(@IdParam('commentId') commentId: string, @CurrentUser() userId: string): Promise<void> {
    return this.comments.delete(commentId, userId);
  }
}
