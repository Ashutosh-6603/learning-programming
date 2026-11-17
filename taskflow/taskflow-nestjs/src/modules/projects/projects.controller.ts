import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { ColumnsService } from './columns.service.js';
import {
  BoardDto,
  ColumnDto,
  CreateColumnDto,
  CreateProjectDto,
  MoveColumnDto,
  ProjectDto,
  UpdateColumnDto,
  UpdateProjectDto,
} from './project.dto.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@Controller(API_PREFIX)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly columns: ColumnsService,
  ) {}

  @Get('workspaces/:workspaceId/projects')
  @ApiPage(ProjectDto)
  list(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<ProjectDto>> {
    return this.projects.list(workspaceId, userId, query.limit, query.cursor);
  }

  @Post('workspaces/:workspaceId/projects')
  create(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.create(workspaceId, userId, dto);
  }

  @Get('projects/:projectId')
  get(@IdParam('projectId') projectId: string, @CurrentUser() userId: string): Promise<ProjectDto> {
    return this.projects.get(projectId, userId);
  }

  @Patch('projects/:projectId')
  update(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.update(projectId, userId, defined(dto));
  }

  @Delete('projects/:projectId')
  @HttpCode(204)
  delete(@IdParam('projectId') projectId: string, @CurrentUser() userId: string): Promise<void> {
    return this.projects.delete(projectId, userId);
  }

  @Get('projects/:projectId/board')
  board(@IdParam('projectId') projectId: string, @CurrentUser() userId: string): Promise<BoardDto> {
    return this.projects.board(projectId, userId);
  }

  @Post('projects/:projectId/columns')
  createColumn(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateColumnDto,
  ): Promise<ColumnDto> {
    return this.columns.create(projectId, userId, dto);
  }

  @Patch('columns/:columnId')
  updateColumn(
    @IdParam('columnId') columnId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateColumnDto,
  ): Promise<ColumnDto> {
    return this.columns.update(columnId, userId, defined(dto));
  }

  @Delete('columns/:columnId')
  @HttpCode(204)
  deleteColumn(
    @IdParam('columnId') columnId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.columns.delete(columnId, userId);
  }

  @Post('columns/:columnId/move')
  @HttpCode(200)
  moveColumn(
    @IdParam('columnId') columnId: string,
    @CurrentUser() userId: string,
    @Body() dto: MoveColumnDto,
  ): Promise<ColumnDto> {
    return this.columns.move(columnId, userId, dto.afterColumnId);
  }
}
