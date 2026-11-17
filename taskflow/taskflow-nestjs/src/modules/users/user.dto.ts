import { IsString, Length } from 'class-validator';
import { IsOmittable, Trim } from '../../common/validation/decorators.js';

export class UpdateUserDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 80)
  displayName?: string;
}

export class UserSummaryDto {
  id: string;
  email: string;
  displayName: string;
}

export class UserDto extends UserSummaryDto {
  createdAt: string;
}

/** Explicit field-by-field mapping: nothing reaches the wire unless it's listed here. */
export const toUserSummary = (u: UserSummaryDto): UserSummaryDto => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
});

export const toUser = (u: UserSummaryDto & { createdAt: Date }): UserDto => ({
  ...toUserSummary(u),
  createdAt: u.createdAt.toISOString(),
});
