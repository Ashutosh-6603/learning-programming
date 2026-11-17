import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { InvitationsService } from './invitations.service.js';
import { MembersService } from './members.service.js';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  CreateWorkspaceDto,
  InvitationDto,
  MemberDto,
  UpdateMemberDto,
  UpdateWorkspaceDto,
  WorkspaceDto,
} from './workspace.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('workspaces')
@Controller(API_PREFIX)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get('workspaces')
  @ApiPage(WorkspaceDto)
  list(@CurrentUser() userId: string, @Query() query: PageQueryDto): Promise<Page<WorkspaceDto>> {
    return this.workspaces.list(userId, query.limit, query.cursor);
  }

  @Post('workspaces')
  create(@CurrentUser() userId: string, @Body() dto: CreateWorkspaceDto): Promise<WorkspaceDto> {
    return this.workspaces.create(userId, dto);
  }

  @Get('workspaces/:workspaceId')
  get(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
  ): Promise<WorkspaceDto> {
    return this.workspaces.get(workspaceId, userId);
  }

  @Patch('workspaces/:workspaceId')
  update(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceDto> {
    return this.workspaces.update(workspaceId, userId, defined(dto));
  }

  @Delete('workspaces/:workspaceId')
  @HttpCode(204)
  delete(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.workspaces.delete(workspaceId, userId);
  }

  @Get('workspaces/:workspaceId/members')
  @ApiPage(MemberDto)
  listMembers(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<MemberDto>> {
    return this.members.list(workspaceId, userId, query.limit, query.cursor);
  }

  @Patch('workspaces/:workspaceId/members/:userId')
  updateMember(
    @IdParam('workspaceId') workspaceId: string,
    @IdParam('userId') targetUserId: string,
    @CurrentUser() userId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.members.updateRole(workspaceId, userId, targetUserId, dto.role);
  }

  @Delete('workspaces/:workspaceId/members/:userId')
  @HttpCode(204)
  removeMember(
    @IdParam('workspaceId') workspaceId: string,
    @IdParam('userId') targetUserId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.members.remove(workspaceId, userId, targetUserId);
  }

  @Get('workspaces/:workspaceId/invitations')
  @ApiPage(InvitationDto)
  listInvitations(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<InvitationDto>> {
    return this.invitations.list(workspaceId, userId, query.limit, query.cursor);
  }

  @Post('workspaces/:workspaceId/invitations')
  invite(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateInvitationDto,
  ): Promise<InvitationDto> {
    return this.invitations.create(workspaceId, userId, dto);
  }

  @Delete('workspaces/:workspaceId/invitations/:invitationId')
  @HttpCode(204)
  revokeInvitation(
    @IdParam('workspaceId') workspaceId: string,
    @IdParam('invitationId') invitationId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.invitations.revoke(workspaceId, userId, invitationId);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  acceptInvitation(
    @CurrentUser() userId: string,
    @Body() dto: AcceptInvitationDto,
  ): Promise<WorkspaceDto> {
    return this.invitations.accept(userId, dto.token);
  }
}
