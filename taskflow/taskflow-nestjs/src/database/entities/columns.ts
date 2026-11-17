import { CreateDateColumn, PrimaryColumn, UpdateDateColumn, type ValueTransformer } from 'typeorm';

/** `id uuid PRIMARY KEY DEFAULT uuidv7()`: Postgres 18 generates time-sortable ids itself. */
export const Id = () => PrimaryColumn('uuid', { default: () => 'uuidv7()' });

export const CreatedAt = () => CreateDateColumn({ type: 'timestamptz' });
export const UpdatedAt = () => UpdateDateColumn({ type: 'timestamptz' });

/** node-postgres returns bigint as a string (it can exceed 2^53); file sizes never do. */
export const bigintAsNumber: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
