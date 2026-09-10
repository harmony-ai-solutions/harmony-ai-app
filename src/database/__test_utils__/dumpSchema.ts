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

/**
 * Strip SQL comments in a string-literal-aware way (§9-A8).
 *
 * Removes `--` line comments (to end-of-line, including the newline so the
 * following text does not leave a trailing space) and block comments. A
 * single-quote state machine with `''` escaping protects string bodies that
 * contain comment lookalikes (e.g. `DEFAULT 'a--b'` survives verbatim).
 * Must run BEFORE whitespace collapse — otherwise the inline `--` comment has
 * no recoverable terminator and a comparator-side stripper would truncate DDL
 * at the first comment.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const len = sql.length;
  let inString = false;

  while (i < len) {
    const c = sql[i];
    const next = i + 1 < len ? sql[i + 1] : '';

    if (inString) {
      out += c;
      if (c === "'") {
        if (next === "'") {
          // Escaped single-quote inside a literal: carry both characters.
          out += next;
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }

    if (c === "'") {
      inString = true;
      out += c;
      i++;
      continue;
    }

    if (c === '-' && next === '-') {
      // Line comment: skip to (and including) the newline.
      while (i < len && sql[i] !== '\n') {
        i++;
      }
      if (i < len && sql[i] === '\n') {
        i++;
      }
      continue;
    }

    if (c === '/' && next === '*') {
      // Block comment: skip to the closing marker.
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      if (i < len) {
        i += 2; // consume the closing marker
      }
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/**
 * Canonicalize the `CREATE TABLE` header's table-name quoting (§9-A13).
 *
 * Strips the surrounding double quotes on the HEADER table name only:
 *   CREATE TABLE "name" (       → CREATE TABLE name (
 *   CREATE TABLE IF NOT EXISTS "x" ( → CREATE TABLE IF NOT EXISTS x (
 * Double quotes in string literals elsewhere (e.g. `DEFAULT 'say "hi"'`) and
 * quoted column names later in the DDL are NOT touched. Applied AFTER comment
 * stripping + whitespace collapse so `CREATE TABLE  "name"` (comment residue)
 * is normalized too.
 */
function unquoteHeaderTableName(sql: string): string {
  return sql.replace(
    /^(CREATE TABLE(?: IF NOT EXISTS)?)\s+"([^"]+)"(?=\s*\()/,
    (_match, prefix: string, name: string) => `${prefix} ${name}`,
  );
}

/**
 * Normalize a SQLite master `sql` string for deterministic cross-implementation
 * comparison.
 *
 * Order: comment-strip (§9-A8) → whitespace collapse → header unquote (§9-A13)
 * → trailing-semicolon strip → trim.
 */
export function normalizeSql(sql: string): string {
  return unquoteHeaderTableName(
    stripSqlComments(sql).replace(/\s+/g, ' '), // collapse whitespace
  )
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
