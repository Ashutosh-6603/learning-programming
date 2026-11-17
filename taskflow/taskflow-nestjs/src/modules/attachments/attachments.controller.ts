import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import {
  AttachmentDto,
  AttachmentUploadDto,
  CreateAttachmentDto,
  DownloadUrlDto,
} from './attachment.dto.js';
import { AttachmentsService } from './attachments.service.js';

@ApiTags('attachments')
@Controller(API_PREFIX)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('tasks/:taskId/attachments')
  @ApiPage(AttachmentDto)
  list(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<AttachmentDto>> {
    return this.attachments.list(taskId, userId, query.limit, query.cursor);
  }

  @Post('tasks/:taskId/attachments')
  create(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateAttachmentDto,
  ): Promise<AttachmentUploadDto> {
    return this.attachments.create(taskId, userId, dto);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(204)
  delete(
    @IdParam('attachmentId') attachmentId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.attachments.delete(attachmentId, userId);
  }

  @Post('attachments/:attachmentId/complete')
  @HttpCode(200)
  complete(
    @IdParam('attachmentId') attachmentId: string,
    @CurrentUser() userId: string,
  ): Promise<AttachmentDto> {
    return this.attachments.complete(attachmentId, userId);
  }

  @Get('attachments/:attachmentId/download')
  download(
    @IdParam('attachmentId') attachmentId: string,
    @CurrentUser() userId: string,
  ): Promise<DownloadUrlDto> {
    return this.attachments.download(attachmentId, userId);
  }
}
