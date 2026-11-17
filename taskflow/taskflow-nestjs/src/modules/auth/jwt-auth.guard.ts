import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { unauthorized } from '../../common/problem.js';
import { IS_PUBLIC } from './decorators.js';

/**
 * Registered globally, so every route requires a valid access token unless it (or its
 * controller) is marked @Public(). Secure by default: forgetting a decorator locks a route.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }

  /** Passport calls this with the strategy's result; `info` says why there is no user. */
  override handleRequest<TUser>(err: unknown, user: TUser | false, info: unknown): TUser {
    if (err || !user) {
      const missing = info instanceof Error && info.message === 'No auth token';
      throw unauthorized(missing ? undefined : 'Invalid or expired access token');
    }
    return user;
  }
}
