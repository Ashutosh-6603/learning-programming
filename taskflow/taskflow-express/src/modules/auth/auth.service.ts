import { conflict, unauthorized } from '../../lib/problem.js';
import { toUser, type UserDto } from '../users/users.dto.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { AccessToken, AccessTokens } from './access-tokens.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import type { RefreshTokens } from './refresh-tokens.js';

export interface Session {
  body: AccessToken & { user: UserDto };
  refreshToken: string;
}

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly accessTokens: AccessTokens,
    private readonly refreshTokens: RefreshTokens,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<Session> {
    if (await this.users.findByEmail(input.email)) throw conflict('Email is already registered');
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
    });
    return this.startSession(user);
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.users.findByEmail(email);
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!user || !ok) throw unauthorized('Invalid email or password');
    return this.startSession(user);
  }

  async refresh(token: string | undefined): Promise<{ body: AccessToken; refreshToken: string }> {
    if (!token) throw unauthorized('Missing refresh token');
    const result = await this.refreshTokens.rotate(token);
    if (result.status !== 'ok') throw unauthorized('Invalid refresh token');
    return { body: this.accessTokens.issue(result.userId), refreshToken: result.token };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.refreshTokens.revokeFamily(token);
  }

  private async startSession(
    user: Parameters<typeof toUser>[0] & { id: string },
  ): Promise<Session> {
    return {
      body: { ...this.accessTokens.issue(user.id), user: toUser(user) },
      refreshToken: await this.refreshTokens.issue(user.id),
    };
  }
}
