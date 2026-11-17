import { argon2id, hash, verify, type HashOptions } from 'argon2';

// OWASP baseline for argon2id: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS: HashOptions = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);

export const verifyPassword = (passwordHash: string, password: string) =>
  verify(passwordHash, password);

let dummyHash: Promise<string> | undefined;

/** Burns the same CPU time as a real check, so unknown emails can't be detected by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verify(await dummyHash, password);
  return false;
}
