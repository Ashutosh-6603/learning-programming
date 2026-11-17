import type { MigrationInterface } from 'typeorm';
import { Init1794480000000 } from './1794480000000-Init.js';

/** Every migration class, oldest first. Add each new migration here after generating it. */
export const MIGRATIONS: (new () => MigrationInterface)[] = [Init1794480000000];
