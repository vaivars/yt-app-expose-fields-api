import { describe, expect, it } from 'vitest';
import { deriveBaseUrl, listNames, normalizeName, parseNames } from '../../src/core/config';

describe('listNames', () => {
  it('keeps names as written, trimmed, dropping blanks and later duplicates that differ only in case', () => {
    expect(listNames(' External ID, "Fix versions, legacy",, external id ,Typo')).toEqual([
      'External ID',
      'Fix versions, legacy',
      'Typo',
    ]);
    expect(listNames('A\nB, C\n')).toEqual(['A', 'B, C']);
    expect(listNames(undefined)).toEqual([]);
  });
});

describe('parseNames', () => {
  it('splits on commas and normalizes names', () => {
    expect(parseNames(' External ID, Sync State ')).toEqual(new Set(['external id', 'sync state']));
  });

  it('splits only on newlines when the value has several lines, so names may contain commas', () => {
    expect(parseNames('Fix versions, legacy\r\nExternal ID\n')).toEqual(
      new Set(['fix versions, legacy', 'external id']),
    );
  });

  it('accepts double-quoted names so a name can contain a comma (the settings field is a single line)', () => {
    expect(parseNames('HF External ID, "Fix versions, legacy", HF Sync State')).toEqual(
      new Set(['hf external id', 'fix versions, legacy', 'hf sync state']),
    );
  });

  it('reads an unterminated quote up to the end of the value', () => {
    expect(parseNames('A, "B, C')).toEqual(new Set(['a', 'b, c']));
  });

  it('ignores a leading or trailing newline around a comma-separated value', () => {
    expect(parseNames('A, B\n')).toEqual(new Set(['a', 'b']));
    expect(parseNames('\r\nA, B')).toEqual(new Set(['a', 'b']));
  });

  it('drops blank entries and duplicates that differ only in case', () => {
    expect(parseNames('A,, a ,\t,B')).toEqual(new Set(['a', 'b']));
  });

  it('returns an empty set for a missing or blank value', () => {
    expect(parseNames(undefined)).toEqual(new Set());
    expect(parseNames(null)).toEqual(new Set());
    expect(parseNames('  \n ')).toEqual(new Set());
  });
});

describe('normalizeName', () => {
  it('trims and lowercases', () => {
    expect(normalizeName('  Sync State ')).toBe('sync state');
  });
});

describe('deriveBaseUrl', () => {
  it('strips /issue/<id> from the issue URL, keeping a context path', () => {
    expect(deriveBaseUrl('https://example.youtrack.cloud/issue/ABC-1')).toBe('https://example.youtrack.cloud');
    expect(deriveBaseUrl('https://host.example/youtrack/issue/ABC-1')).toBe('https://host.example/youtrack');
  });

  it('prefers a non-blank override and drops trailing slashes', () => {
    expect(deriveBaseUrl('https://a.example/issue/X-1', ' http://localhost:8080/ ')).toBe('http://localhost:8080');
  });

  it('ignores a blank override', () => {
    expect(deriveBaseUrl('https://a.example/issue/X-1', '   ')).toBe('https://a.example');
  });

  it('asks for the youtrackUrl setting when the issue URL has no /issue/ segment', () => {
    expect(() => deriveBaseUrl('https://a.example/whatever')).toThrow(/youtrackUrl/);
  });
});
