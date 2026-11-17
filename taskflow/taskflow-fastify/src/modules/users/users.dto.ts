import { Type, type Static } from 'typebox';
import { Id, Timestamp } from '../../lib/schemas.js';

export const UserSummary = Type.Object({
  id: Id,
  email: Type.String(),
  displayName: Type.String(),
});
export const User = Type.Object({ ...UserSummary.properties, createdAt: Timestamp });

export type UserSummaryDto = Static<typeof UserSummary>;
export type UserDto = Static<typeof User>;

export const toUserSummary = (u: UserSummaryDto): UserSummaryDto => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
});

export const toUser = (u: UserSummaryDto & { createdAt: Date }): UserDto => ({
  ...toUserSummary(u),
  createdAt: u.createdAt.toISOString(),
});
