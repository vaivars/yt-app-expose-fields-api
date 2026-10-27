import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canUseExposedFields } from '../../src/core/access';

const user = (groups: string[]) => ({ isInGroup: (name: string) => groups.includes(name) });

describe('canUseExposedFields', () => {
  it('denies everyone when no group is set or the caller cannot see it', () => {
    for (const group of [undefined, null, {}, { name: null }, { name: '' }]) {
      expect(canUseExposedFields(group, user(['Integrations', '']))).toBe(false);
    }
  });

  it('allows only members of the group', () => {
    expect(canUseExposedFields({ name: 'Integrations' }, user(['Integrations']))).toBe(true);
    expect(canUseExposedFields({ name: 'Integrations' }, user(['Developers']))).toBe(false);
  });
});

describe('the Allowed group setting', () => {
  it('is required and picked from the YouTrack groups', () => {
    const schema = JSON.parse(readFileSync('src/settings.json', 'utf8')) as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(schema.properties.allowedGroup).toMatchObject({
      type: 'object',
      'x-entity': 'UserGroup',
      'x-scope': 'GLOBAL',
    });
    expect(schema.required).toContain('allowedGroup');
  });
});
