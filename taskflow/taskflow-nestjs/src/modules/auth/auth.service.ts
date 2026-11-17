import { Injectable } from '@nestjs/common';
import { conflict, unauthorized } from '../../common/problem.js';
import type { User } from '../../database/entities/user.entity.js';
import { toUser, type UserDto } from '../users/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import { RefreshTokens } from './refresh-tokens.service.js';

/** The service proves who you are; the controller turns that into an access token and a cookie. */
export interface Session {
  user: UserDto;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokens,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<Session> {
    if (await this.users.findByEmailWithPassword(input.email)) {
      throw conflict('Email is already registered');
    }
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
    });
    return this.startSession(user);
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.users.findByEmailWithPassword(email);
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!user || !ok) throw unauthorized('Invalid email or password');
    return this.startSession(user);
  }

  async refresh(token: string | undefined): Promise<{ userId: string; refreshToken: string }> {
    if (!token) throw unauthorized('Missing refresh token');
    const result = await this.refreshTokens.rotate(token);
    if (result.status !== 'ok') throw unauthorized('Invalid refresh token');
    return { userId: result.userId, refreshToken: result.token };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.refreshTokens.revokeFamily(token);
  }

  private async startSession(user: User): Promise<Session> {
    return { user: toUser(user), refreshToken: await this.refreshTokens.issue(user.id) };
  }
}
