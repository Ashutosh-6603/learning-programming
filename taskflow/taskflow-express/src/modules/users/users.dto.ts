export interface UserSummaryDto {
  id: string;
  email: string;
  displayName: string;
}

export interface UserDto extends UserSummaryDto {
  createdAt: string;
}

export const toUserSummary = (u: UserSummaryDto): UserSummaryDto => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
});

export const toUser = (u: UserSummaryDto & { createdAt: Date }): UserDto => ({
  ...toUserSummary(u),
  createdAt: u.createdAt.toISOString(),
});
