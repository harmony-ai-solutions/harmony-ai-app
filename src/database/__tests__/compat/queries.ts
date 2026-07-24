import type {DatabaseResultSet} from '../../types';
import type {NodeDatabase} from '../../__test_utils__/nodeDatabase';

/**
 * A single query case for the adapter compatibility test suite.
 * Each case can have an optional setup (one or more SQL statements to run
 * before the test query), the query itself, and various validators.
 */
export interface QueryCase {
  name: string;
  /** SQL statements to run before the test query (e.g. CREATE TABLE). */
  setup?: string[];
  /** The query under test. */
  sql: string;
  /** Bound parameters (optional). */
  params?: any[];
  /** Validate the result set. Receives the result and the db context. */
  validate?: (result: DatabaseResultSet, ctx: {db: NodeDatabase}) => void;
  validateInsertId?: (insertId: number | undefined) => void;
  validateRowsAffected?: (n: number) => void;
}

export const queryCases: QueryCase[] = [
  // ======================================================================
  // SELECT — literal values
  // ======================================================================
  {
    name: 'select integer literal',
    sql: 'SELECT 42 AS x',
    validate: r => expect(r.rows.item(0).x).toBe(42),
  },
  {
    name: 'select float literal',
    sql: 'SELECT 3.14 AS x',
    validate: r => expect(r.rows.item(0).x).toBeCloseTo(3.14),
  },
  {
    name: 'select string literal',
    sql: "SELECT 'hello' AS s",
    validate: r => expect(r.rows.item(0).s).toBe('hello'),
  },
  {
    name: 'select null literal',
    sql: 'SELECT NULL AS n',
    validate: r => expect(r.rows.item(0).n).toBeNull(),
  },

  // ======================================================================
  // INSERT — basic and returning insertId
  // ======================================================================
  {
    name: 'INSERT with integer param',
    setup: ['CREATE TABLE t_int (n INTEGER)'],
    sql: 'INSERT INTO t_int VALUES (?)',
    params: [42],
    validateRowsAffected: n => expect(n).toBe(1),
  },
  {
    name: 'INSERT with float param',
    setup: ['CREATE TABLE t_float (n REAL)'],
    sql: 'INSERT INTO t_float VALUES (?)',
    params: [3.14],
    validateRowsAffected: n => expect(n).toBe(1),
  },
  {
    name: 'INSERT with null param',
    setup: ['CREATE TABLE t_null (n INTEGER)'],
    sql: 'INSERT INTO t_null VALUES (?)',
    params: [null],
    validateRowsAffected: n => expect(n).toBe(1),
  },
  {
    name: 'INSERT with string param',
    setup: ['CREATE TABLE t_str (s TEXT)'],
    sql: 'INSERT INTO t_str VALUES (?)',
    params: ['hello'],
    validateRowsAffected: n => expect(n).toBe(1),
  },
  {
    name: 'INSERT with boolean param (stored as 0/1)',
    setup: ['CREATE TABLE t_bool (b INTEGER)'],
    sql: 'INSERT INTO t_bool VALUES (?)',
    params: [true],
    validateRowsAffected: n => expect(n).toBe(1),
  },

  // ======================================================================
  // BLOB handling
  // ======================================================================
  {
    name: 'INSERT BLOB',
    setup: ['CREATE TABLE t_blob (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB)'],
    sql: 'INSERT INTO t_blob (data) VALUES (?)',
    params: [Buffer.from([0x00, 0xFF, 0xAB, 0xCD])],
    validateRowsAffected: n => expect(n).toBe(1),
    // NOTE: BLOB SELECT validation differs between adapters:
    //   Node: returns Buffer
    //   RN: returns base64 string
    // This is a known divergence documented in adapter-compat-findings.md
  },

  // ======================================================================
  // Multi-row results
  // ======================================================================
  {
    name: 'multi-row SELECT',
    setup: [
      'CREATE TABLE t_multi (x INTEGER)',
      "INSERT INTO t_multi VALUES (1), (2), (3)",
    ],
    sql: 'SELECT x FROM t_multi ORDER BY x',
    validate: r => {
      expect(r.rows.length).toBe(3);
      expect(r.rows.item(0).x).toBe(1);
      expect(r.rows.item(1).x).toBe(2);
      expect(r.rows.item(2).x).toBe(3);
    },
  },

  // ======================================================================
  // JOIN
  // ======================================================================
  {
    name: 'INNER JOIN',
    setup: [
      'CREATE TABLE t_a (id INTEGER PRIMARY KEY, val TEXT)',
      'CREATE TABLE t_b (id INTEGER PRIMARY KEY, a_id INTEGER, label TEXT)',
      "INSERT INTO t_a VALUES (1, 'alpha')",
      "INSERT INTO t_a VALUES (2, 'beta')",
      "INSERT INTO t_b VALUES (1, 1, 'label_a')",
      "INSERT INTO t_b VALUES (2, 2, 'label_b')",
    ],
    sql: 'SELECT a.val, b.label FROM t_a a INNER JOIN t_b b ON a.id = b.a_id ORDER BY a.id',
    validate: r => {
      expect(r.rows.length).toBe(2);
      expect(r.rows.item(0).val).toBe('alpha');
      expect(r.rows.item(0).label).toBe('label_a');
      expect(r.rows.item(1).val).toBe('beta');
      expect(r.rows.item(1).label).toBe('label_b');
    },
  },

  // ======================================================================
  // UPDATE and rowsAffected
  // ======================================================================
  {
    name: 'UPDATE matching rows (rowsAffected > 0)',
    setup: [
      'CREATE TABLE t_upd (id INTEGER PRIMARY KEY, val TEXT)',
      "INSERT INTO t_upd VALUES (1, 'a')",
      "INSERT INTO t_upd VALUES (2, 'b')",
    ],
    sql: 'UPDATE t_upd SET val = ? WHERE id = ?',
    params: ['updated', 1],
    validateRowsAffected: n => expect(n).toBe(1),
  },
  {
    name: 'UPDATE no matching rows (rowsAffected = 0)',
    setup: ['CREATE TABLE t_upd2 (id INTEGER PRIMARY KEY, val TEXT)'],
    sql: 'UPDATE t_upd2 SET val = ? WHERE id = ?',
    params: ['x', 999],
    validateRowsAffected: n => expect(n).toBe(0),
  },

  // ======================================================================
  // DELETE
  // ======================================================================
  {
    name: 'DELETE matching rows',
    setup: [
      'CREATE TABLE t_del (id INTEGER PRIMARY KEY)',
      'INSERT INTO t_del VALUES (1)',
      'INSERT INTO t_del VALUES (2)',
    ],
    sql: 'DELETE FROM t_del WHERE id = ?',
    params: [1],
    validateRowsAffected: n => expect(n).toBe(1),
  },

  // ======================================================================
  // Transaction commit
  // ======================================================================
  {
    name: 'transaction commit persists changes',
    setup: ['CREATE TABLE t_tx_commit (x INTEGER)'],
    sql: 'INSERT INTO t_tx_commit VALUES (42)',
    // This runs inside a transaction (handled by the test)
    validateRowsAffected: n => expect(n).toBe(1),
  },

  // ======================================================================
  // Aggregate functions
  // ======================================================================
  {
    name: 'COUNT aggregate',
    setup: [
      'CREATE TABLE t_count (id INTEGER PRIMARY KEY)',
      'INSERT INTO t_count VALUES (1), (2), (3)',
    ],
    sql: 'SELECT COUNT(*) AS cnt FROM t_count',
    validate: r => expect(r.rows.item(0).cnt).toBe(3),
  },

  // ======================================================================
  // PRAGMA
  // ======================================================================
  {
    name: 'PRAGMA table_info',
    setup: ['CREATE TABLE t_pragma (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'],
    sql: 'PRAGMA table_info(t_pragma)',
    validate: r => {
      expect(r.rows.length).toBeGreaterThanOrEqual(2);
    },
  },

  // ======================================================================
  // String with unicode
  // ======================================================================
  {
    name: 'unicode string',
    setup: ['CREATE TABLE t_unicode (s TEXT)'],
    sql: 'INSERT INTO t_unicode VALUES (?)',
    params: ['Hëllö Wörld 🔥'],
    validateRowsAffected: n => expect(n).toBe(1),
  },
];
