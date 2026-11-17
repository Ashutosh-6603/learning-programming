import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { TaskDto } from '../projects/project.dto.js';
import { CreateTaskDto, ListTasksQueryDto, MoveTaskDto, UpdateTaskDto } from './task.dto.js';
import { TasksService } from './tasks.service.js';

@ApiTags('tasks')
@Controller(API_PREFIX)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('projects/:projectId/tasks')
  @ApiPage(TaskDto)
  list(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<Page<TaskDto>> {
    const { limit, cursor, ...filters } = query;
    return this.tasks.list(projectId, userId, defined(filters), limit, cursor);
  }

  @Post('projects/:projectId/tasks')
  create(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDto> {
    return this.tasks.create(projectId, userId, dto);
  }

  @Get('tasks/:taskId')
  get(@IdParam('taskId') taskId: string, @CurrentUser() userId: string): Promise<TaskDto> {
    return this.tasks.get(taskId, userId);
  }

  @Patch('tasks/:taskId')
  update(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    return this.tasks.update(taskId, userId, defined(dto));
  }

  @Delete('tasks/:taskId')
  @HttpCode(204)
  delete(@IdParam('taskId') taskId: string, @CurrentUser() userId: string): Promise<void> {
    return this.tasks.delete(taskId, userId);
  }

  @Post('tasks/:taskId/move')
  @HttpCode(200)
  move(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Body() dto: MoveTaskDto,
  ): Promise<TaskDto> {
    return this.tasks.move(taskId, userId, dto);
  }
}
