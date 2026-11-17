import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env.js';

export const ISSUER = 'taskflow';
export const AUDIENCE = 'taskflow-api';

/**
 * Passport's "jwt" strategy: finds the Bearer token, verifies signature, expiry, issuer and
 * audience, then calls validate(). Whatever validate() returns becomes `request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      // The typings flag this option as deprecated for issuer/audience; clockTolerance has no other home.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      jsonWebTokenOptions: { clockTolerance: 30 },
    });
  }

  validate(payload: { sub: string }): { id: string } {
    return { id: payload.sub };
  }
}
