import { applyDecorators, Body, Injectable, type PipeTransform } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { UUID } from './parse-id.pipe.js';
import { invalidBody } from './request-validation.pipe.js';

/** Trims a string before its length is checked, so "  " counts as empty. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export const ToLowerCase = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );

/**
 * The field may be left out. class-validator's own @IsOptional() also lets `null` through,
 * which would reach a NOT NULL column; this one skips validation for `undefined` only.
 */
export const IsOmittable = () => ValidateIf((_, value) => value !== undefined);

/** The field may be `null` (PATCH: "clear this value"). */
export const IsNullable = () => ValidateIf((_, value) => value !== null);

/** A UUID, by the same pattern the path-parameter pipe uses. */
export const IsId = () => Matches(UUID, { message: 'must be a UUID' });

const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

/** A full timestamp with an offset ("2026-10-25T12:00:00Z"); a bare date is rejected. */
export const IsDateTime = () =>
  applyDecorators(
    Matches(RFC_3339, { message: 'must be an ISO-8601 date-time' }),
    IsISO8601({ strict: true }, { message: 'must be an ISO-8601 date-time' }),
  );

/** After unknown keys are stripped, a PATCH body must still change something. */
@Injectable()
export class NonEmptyPatchPipe implements PipeTransform<object, object> {
  transform(value: object): object {
    if (Object.values(value).every((field) => field === undefined)) {
      throw invalidBody('at least one field is required');
    }
    return value;
  }
}

/** `@PatchBody() dto: UpdateTaskDto`: a validated body with at least one field present. */
export const PatchBody = () => Body(NonEmptyPatchPipe);

/** Drops `undefined` fields: what's left is exactly what the client sent. */
export function defined<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
