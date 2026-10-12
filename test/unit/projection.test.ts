import { describe, expect, it } from 'vitest';
import { FULL_PROJECTION, ISSUE_PROJECTION } from '../../src/core/projection';

describe('projections', () => {
  it('FULL_PROJECTION requests field names and values but never user emails', () => {
    expect(FULL_PROJECTION.startsWith('$type,id,name,')).toBe(true);
    expect(FULL_PROJECTION).toContain('value(');
    expect(FULL_PROJECTION).not.toMatch(/email/i);
  });

  it('ISSUE_PROJECTION requests only attributes every reader of the issue can see', () => {
    expect(ISSUE_PROJECTION).toBe(
      'idReadable,summary,description,created,updated,resolved,reporter($type,login,fullName),project($type,shortName,name)',
    );
  });
});
