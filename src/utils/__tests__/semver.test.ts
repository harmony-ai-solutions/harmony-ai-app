/**
 * semver — normalization + precedence table (plan 7-10 §3/§4).
 *
 * The load-bearing case is the engine's own pin: `v0.3.0-dev` must sort BELOW
 * `0.3.0` (a prerelease of a release is older than the release), so a manifest
 * advertising `v0.3.0` correctly reads as "newer" than the shipped dev build.
 */

import {
  compareSemver,
  isNewerVersion,
  normalizeVersion,
  parseSemver,
} from '../semver';

describe('normalizeVersion', () => {
  it('strips a leading v/V and surrounding whitespace', () => {
    expect(normalizeVersion('v0.3.0')).toBe('0.3.0');
    expect(normalizeVersion('V1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('  0.3.0-dev ')).toBe('0.3.0-dev');
  });
});

describe('parseSemver', () => {
  it('parses MAJOR.MINOR.PATCH with prerelease + build metadata', () => {
    expect(parseSemver('v0.3.0-dev')).toEqual({
      major: 0,
      minor: 3,
      patch: 0,
      prerelease: ['dev'],
      raw: 'v0.3.0-dev',
    });
    expect(parseSemver('1.2.3+build.5')?.prerelease).toEqual([]);
  });

  it('accepts MAJOR.MINOR (missing patch = 0) and dotted prereleases', () => {
    expect(parseSemver('1.0')?.patch).toBe(0);
    expect(parseSemver('1.0-dev')?.prerelease).toEqual(['dev']);
    expect(parseSemver('1.0.0-rc.1')?.prerelease).toEqual(['rc', '1']);
  });

  it('returns null for non-versions', () => {
    expect(parseSemver('latest')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('v1')).toBeNull();
  });
});

describe('compareSemver — precedence table', () => {
  const table: Array<[string, string, number]> = [
    ['0.3.0', '0.3.0', 0],
    ['v0.3.0', '0.3.0', 0],
    ['0.3.1', '0.3.0', 1],
    ['0.4.0', '0.3.9', 1],
    ['1.0.0', '0.9.9', 1],
    ['0.3.0-dev', '0.3.0', -1], // the load-bearing case
    ['0.3.0', '0.3.0-dev', 1],
    ['0.3.0-dev', '0.3.0-dev', 0],
    ['0.3.0-alpha', '0.3.0-beta', -1],
    ['0.3.0-rc.1', '0.3.0-rc.2', -1],
    ['0.3.0-rc.10', '0.3.0-rc.2', 1], // numeric identifiers compare numerically
    ['0.3.0-1', '0.3.0-alpha', -1], // numeric < alphanumeric
    ['0.3.0-dev', '0.2.9', 1], // core wins over prerelease
  ];

  it.each(table)('compareSemver(%s, %s) === %d', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });

  it('returns null when either side is unparseable', () => {
    expect(compareSemver('latest', '0.3.0')).toBeNull();
    expect(compareSemver('0.3.0', 'nope')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('is true only for a strictly newer, parseable version', () => {
    expect(isNewerVersion('v0.3.2', '0.3.0')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.3.0', '0.3.0-dev')).toBe(true);
    expect(isNewerVersion('0.3.0-dev', '0.3.0')).toBe(false);
    expect(isNewerVersion('latest', '0.3.0')).toBe(false); // unparseable → no nag
  });
});
