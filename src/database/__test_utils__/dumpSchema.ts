import type {Database} from '../types';

export interface NormalizedSchemaEntry {
  type: 'table' | 'index' | 'trigger' | 'view';
  name: string;
  sql: string;
}

/**
 * Dump and normalize the schema of a Database.
 *
 * Normalization:
 *  - Sort entries by (type, name) so ordering is deterministic
 *  - Collapse runs of whitespace in SQL text to a single space
 *  - Uppercase SQL keywords (optional — see open question)
 *  - Strip trailing semicolons
 *  - Exclude sqlite_internal tables (name LIKE 'sqlite_%')
 */
export async function dumpSchema(db: Database): Promise<NormalizedSchemaEntry[]> {
  const [result] = await db.executeSql(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  );

  const entries: NormalizedSchemaEntry[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    entries.push({
      type: row.type,
      name: row.name,
      sql: normalizeSql(row.sql),
    });
  }
  return entries;
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')       // collapse whitespace
    .replace(/;\s*$/, '')       // strip trailing semicolon
    .trim();
}

/**
 * Render the schema as a deterministic string for snapshotting.
 */
export function renderSchema(entries: NormalizedSchemaEntry[]): string {
  return entries
    .map(e => `-- ${e.type}: ${e.name}\n${e.sql};`)
    .join('\n\n') + '\n';
}
