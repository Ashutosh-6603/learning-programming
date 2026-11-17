import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { conflict, notFound } from '../../common/problem.js';
import { Project } from '../../database/entities/project.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Workspace } from '../../database/entities/workspace.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { toWorkspace } from './workspace.dto.js';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly jobs: Jobs,
  ) {}

  async list(userId: string, limit: number, cursor?: string) {
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    // The (user_id, workspace_id) index serves this query directly: newest workspace first.
    const query = this.members
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.workspace', 'workspace')
      .where('member.userId = :userId', { userId });
    const rows = await keyset(query, 'member.workspaceId', 'DESC', limit, after);
    return toPage(
      rows,
      limit,
      (m) => toWorkspace(m.workspace, m.role),
      (m) => ({ id: m.workspaceId }),
    );
  }

  async create(userId: string, input: { name: string; slug: string }) {
    try {
      const workspace = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(Workspace, { ...input, createdBy: userId }),
        );
        await manager.insert(WorkspaceMember, { workspaceId: created.id, userId, role: 'owner' });
        await this.activity.record(manager, {
          workspaceId: created.id,
          actorId: userId,
          type: 'workspace.created',
          data: { name: created.name },
        });
        return created;
      });
      return toWorkspace(workspace, 'owner');
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug is already taken');
      throw err;
    }
  }

  async get(workspaceId: string, userId: string) {
    const membership = await this.access.member(workspaceId, userId);
    const workspace = await this.workspaces.findOneBy({ id: workspaceId });
    if (!workspace) throw notFound('Workspace');
    return toWorkspace(workspace, membership.role);
  }

  async update(workspaceId: string, userId: string, input: { name?: string; slug?: string }) {
    const membership = await this.access.member(workspaceId, userId, 'admin');
    try {
      const workspace = await this.dataSource.transaction(async (manager) => {
        await manager.update(Workspace, { id: workspaceId }, input);
        const updated = await manager.findOneBy(Workspace, { id: workspaceId });
        if (!updated) throw notFound('Workspace');
        await this.activity.record(manager, {
          workspaceId,
          actorId: userId,
          type: 'workspace.updated',
          data: { ...input },
        });
        return updated;
      });
      return toWorkspace(workspace, membership.role);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug is already taken');
      throw err;
    }
  }

  async delete(workspaceId: string, userId: string) {
    await this.access.member(workspaceId, userId, 'owner');
    const owned = await this.projects.find({ where: { workspaceId }, select: { id: true } });
    await this.workspaces.delete({ id: workspaceId });
    for (const p of owned) {
      await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${p.id}/` });
    }
  }
}
