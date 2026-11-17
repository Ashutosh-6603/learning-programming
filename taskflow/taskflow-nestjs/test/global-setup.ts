import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { validateEnv } from '../src/config/env.js';
import { dataSourceOptions } from '../src/database/data-source-options.js';
import { testEnv } from './test-env.js';

/** Runs once before all test files: create + migrate the test database, ensure the bucket exists. */
export default async function setup(): Promise<void> {
  const url = new URL(testEnv.DATABASE_URL);
  const database = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  const dataSource = new DataSource(dataSourceOptions(testEnv.DATABASE_URL));
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

  const env = validateEnv({ ...process.env, ...testEnv });
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
  s3.destroy();
}
