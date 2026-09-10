/**
 * normalizeSql — dump-writer hardening (A8 comment stripping + A13
 * identifier-quote normalization), cross-implementation fixture set.
 *
 * This is the APP-side copy of the fixture list running in the Go engine as
 * cmd/dump_schema_test.go. Outputs MUST be identical cross-implementation:
 *  - A8: strip line comments (dash dash) and block comments BEFORE the existing
 *    whitespace collapse, using a string-literal-aware state machine (a single
 *    quote with doubled-quote escaping) so string bodies containing comment
 *    lookalikes survive verbatim.
 *  - A13: canonicalize the CREATE TABLE header's table-name quoting — strip
 *    the double quotes on the HEADER name only; string literals elsewhere and
 *    quoted column names are untouched.
 *
 * Normalization order: comment-strip, then whitespace collapse, then header
 * unquote, then trailing-semicolon strip, then trim.
 */

import {normalizeSql} from '../__test_utils__/dumpSchema';

interface NormalizeCase {
  name: string;
  input: string;
  expected: string;
}

const cases: NormalizeCase[] = [
  {
    name: 'inline -- comment mid-DDL is stripped, rest intact',
    input: 'CREATE TABLE foo (a TEXT -- col comment\n, b TEXT)',
    expected: 'CREATE TABLE foo (a TEXT , b TEXT)',
  },
  {
    name: '-- comment at EOF without trailing newline is stripped',
    input: 'CREATE TABLE foo (a TEXT) -- eof',
    expected: 'CREATE TABLE foo (a TEXT)',
  },
  {
    name: 'block comments are stripped',
    input: 'CREATE TABLE /* block */ foo (a TEXT /* inline */ )',
    expected: 'CREATE TABLE foo (a TEXT )',
  },
  {
    name: "string containing -- is preserved verbatim",
    input: "CREATE TABLE foo (a TEXT DEFAULT 'a--b')",
    expected: "CREATE TABLE foo (a TEXT DEFAULT 'a--b')",
  },
  {
    name: "escaped quotes protect a comment-lookalike",
    input: "DEFAULT 'it''s--not-a-comment'",
    expected: "DEFAULT 'it''s--not-a-comment'",
  },
  {
    name: "block-comment-lookalike inside a string is preserved verbatim",
    input: "DEFAULT 'a /* b */ c'",
    expected: "DEFAULT 'a /* b */ c'",
  },
  {
    name: 'quoted CREATE TABLE header name is unquoted',
    input: 'CREATE TABLE "entities" (id TEXT)',
    expected: 'CREATE TABLE entities (id TEXT)',
  },
  {
    name: 'CREATE TABLE IF NOT EXISTS quoted header name is unquoted',
    input: 'CREATE TABLE IF NOT EXISTS "x" (id TEXT)',
    expected: 'CREATE TABLE IF NOT EXISTS x (id TEXT)',
  },
  {
    name: 'double quotes inside a string default are preserved',
    input: "DEFAULT 'say \"hi\"'",
    expected: "DEFAULT 'say \"hi\"'",
  },
  {
    name: 'whitespace collapse is retained',
    input: '  CREATE TABLE foo (a\tTEXT\n  ,\tb TEXT)  ',
    expected: 'CREATE TABLE foo (a TEXT , b TEXT)',
  },
  {
    name: 'trailing semicolon is stripped',
    input: 'CREATE TABLE foo (a TEXT);',
    expected: 'CREATE TABLE foo (a TEXT)',
  },
  {
    name: 'quoted column name is NOT touched',
    input: 'CREATE TABLE t ("col" TEXT)',
    expected: 'CREATE TABLE t ("col" TEXT)',
  },
];

describe('normalizeSql — dump-writer hardening (§9-A8/A13)', () => {
  test.each(cases)('$name', ({input, expected}) => {
    expect(normalizeSql(input)).toBe(expected);
  });

  it('quoted and unquoted CREATE TABLE headers normalize identically (§9-A13)', () => {
    const quoted = normalizeSql('CREATE TABLE "entities" (id TEXT)');
    const unquoted = normalizeSql('CREATE TABLE entities (id TEXT)');
    expect(quoted).toBe(unquoted);
    expect(quoted).toBe('CREATE TABLE entities (id TEXT)');
  });
});
