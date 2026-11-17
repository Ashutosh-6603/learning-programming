import jwt from 'jsonwebtoken';
import { unauthorized } from '../../lib/problem.js';

const ISSUER = 'taskflow';
const AUDIENCE = 'taskflow-api';

export interface AccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export class AccessTokens {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  issue(userId: string): AccessToken {
    const accessToken = jwt.sign({}, this.secret, {
      algorithm: 'HS256',
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.ttlSeconds,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.ttlSeconds };
  }

  /** Returns the user id, or throws 401. */
  verify(token: string): string {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: 30,
      });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error();
      return payload.sub;
    } catch {
      throw unauthorized('Invalid or expired access token');
    }
  }
}
