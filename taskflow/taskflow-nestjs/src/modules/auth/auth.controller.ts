import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Response } from 'express';
import { API_PREFIX } from '../../common/http/routes.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard.js';
import type { Env } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import { Cookie, Public } from './decorators.js';
import { AccessTokenDto, AuthSessionDto, LoginDto, RegisterDto } from './auth.dto.js';

const COOKIE = 'refresh_token';

@Public()
@ApiTags('auth')
@Controller(`${API_PREFIX}/auth`)
export class AuthController {
  private readonly cookie: CookieOptions;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.cookie = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'lax',
      path: `/${API_PREFIX}/auth`,
    };
    this.accessTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    this.refreshTtlSeconds = config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  }

  @RateLimit('auth')
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { user, refreshToken } = await this.auth.register(dto);
    this.setCookie(res, refreshToken);
    return { ...(await this.accessToken(user.id)), user };
  }

  @RateLimit('auth')
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { user, refreshToken } = await this.auth.login(dto.email, dto.password);
    this.setCookie(res, refreshToken);
    return { ...(await this.accessToken(user.id)), user };
  }

  @RateLimit('auth')
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Cookie(COOKIE) token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenDto> {
    const { userId, refreshToken } = await this.auth.refresh(token);
    this.setCookie(res, refreshToken);
    return this.accessToken(userId);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Cookie(COOKIE) token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(token);
    res.clearCookie(COOKIE, this.cookie);
  }

  private setCookie(res: Response, refreshToken: string): void {
    // Express counts maxAge in milliseconds (the Set-Cookie header itself uses seconds).
    res.cookie(COOKIE, refreshToken, { ...this.cookie, maxAge: this.refreshTtlSeconds * 1000 });
  }

  private async accessToken(userId: string): Promise<AccessTokenDto> {
    return {
      accessToken: await this.jwt.signAsync({}, { subject: userId }),
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }
}
