import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';

/** Drizzle `columns` selection for the public user summary (never the password hash). */
export const userSummaryColumns = { id: true, email: true, displayName: true } as const;

export class UsersRepository {
  constructor(private readonly db: Db) {}

  findById(id: string) {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  findByEmail(email: string) {
    return this.db.query.users.findFirst({ where: eq(users.email, email) });
  }

  findSummaries(ids: string[]) {
    return this.db.query.users.findMany({
      where: inArray(users.id, ids),
      columns: userSummaryColumns,
    });
  }

  async create(data: { email: string; passwordHash: string; displayName: string }) {
    const [user] = await this.db.insert(users).values(data).returning();
    if (!user) throw new Error('INSERT … RETURNING returned no row');
    return user;
  }

  async update(id: string, data: { displayName?: string | undefined }) {
    const [user] = await this.db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }
}
