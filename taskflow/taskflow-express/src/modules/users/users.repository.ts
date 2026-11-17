import type { Db } from '../../infra/db.js';

export const userSummarySelect = { id: true, email: true, displayName: true } as const;

export class UsersRepository {
  constructor(private readonly db: Db) {}

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  findSummaries(ids: string[]) {
    return this.db.user.findMany({ where: { id: { in: ids } }, select: userSummarySelect });
  }

  create(data: { email: string; passwordHash: string; displayName: string }) {
    return this.db.user.create({ data });
  }

  update(id: string, data: { displayName?: string }) {
    return this.db.user.update({ where: { id }, data });
  }
}
