import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source-options.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

/** The TypeORM CLI's entry point (`-d dist/database/data-source.js`); the app builds its own. */
export default new DataSource(dataSourceOptions(url));
