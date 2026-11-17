import { DefaultNamingStrategy, type NamingStrategyInterface, type Table } from 'typeorm';

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const nameOf = (table: Table | string) => (typeof table === 'string' ? table : table.name);

/**
 * TypeORM's defaults are camelCase columns and hashed constraint names (PK_cace4a159ff9f2512dd4).
 * This gives the names a Postgres developer expects: snake_case columns, users_pkey, tasks_column_id_fkey.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override columnName(propertyName: string, customName: string | undefined): string {
    return customName ?? snake(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }

  override primaryKeyName(table: Table | string): string {
    return `${nameOf(table)}_pkey`;
  }

  override foreignKeyName(table: Table | string, columnNames: string[]): string {
    return `${nameOf(table)}_${columnNames.join('_')}_fkey`;
  }
}
