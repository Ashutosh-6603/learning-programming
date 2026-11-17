import { ActivityEvent } from './activity-event.entity.js';
import { Attachment } from './attachment.entity.js';
import { BoardColumn } from './board-column.entity.js';
import { Comment } from './comment.entity.js';
import { Invitation } from './invitation.entity.js';
import { Project } from './project.entity.js';
import { Task } from './task.entity.js';
import { User } from './user.entity.js';
import { WorkspaceMember } from './workspace-member.entity.js';
import { Workspace } from './workspace.entity.js';

/** Every entity, listed by hand: no file globbing, so it works the same compiled, bundled or under Vitest. */
export const ENTITIES = [
  User,
  Workspace,
  WorkspaceMember,
  Invitation,
  Project,
  BoardColumn,
  Task,
  Comment,
  Attachment,
  ActivityEvent,
];
