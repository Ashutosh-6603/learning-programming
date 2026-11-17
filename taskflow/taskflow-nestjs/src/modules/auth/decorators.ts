import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from '../../common/problem.js';

export const IS_PUBLIC = 'isPublic';

/** Marks a controller or handler as reachable without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** `@CurrentUser() userId: string`: the authenticated user's id, set by the JWT strategy. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const { user } = context.switchToHttp().getRequest<Request>();
  if (!user) throw unauthorized();
  return user.id;
});

/** `@Cookie('refresh_token') token?: string`: a cookie's value, or undefined when absent or empty. */
export const Cookie = createParamDecorator((name: string, context: ExecutionContext) => {
  const cookies = context.switchToHttp().getRequest<Request>().cookies as Record<string, string>;
  return cookies[name] || undefined;
});
