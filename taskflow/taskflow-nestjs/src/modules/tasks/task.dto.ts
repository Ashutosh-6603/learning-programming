import { IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/page-query.dto.js';
import {
  IsDateTime,
  IsId,
  IsNullable,
  IsOmittable,
  Trim,
} from '../../common/validation/decorators.js';
import { PRIORITIES, type Priority } from '../../database/entities/task.entity.js';

const UUID_OR_NONE = /^(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export class ListTasksQueryDto extends PageQueryDto {
  @IsOmittable()
  @IsId()
  columnId?: string;

  @IsOmittable()
  @Matches(UUID_OR_NONE, { message: 'must be a UUID or "none"' })
  assigneeId?: string;

  @IsOmittable()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOmittable()
  @IsDateTime()
  dueBefore?: string;
}

export class CreateTaskDto {
  @Trim()
  @IsString()
  @Length(1, 200)
  title: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOmittable()
  @IsId()
  columnId?: string;

  @IsOmittable()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOmittable()
  @IsNullable()
  @IsId()
  assigneeId?: string | null;

  @IsOmittable()
  @IsNullable()
  @IsDateTime()
  dueAt?: string | null;
}

export class UpdateTaskDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOmittable()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOmittable()
  @IsNullable()
  @IsId()
  assigneeId?: string | null;

  @IsOmittable()
  @IsNullable()
  @IsDateTime()
  dueAt?: string | null;
}

export class MoveTaskDto {
  @IsId()
  columnId: string;

  // Required, but null is a value: "move to the top of the column".
  @IsNullable()
  @IsId()
  afterTaskId: string | null;
}
