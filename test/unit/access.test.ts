import { describe, expect, it } from 'vitest';
import { canUseExposedFields } from '../../src/core/access';

const user = (groups: string[]) => ({ isInGroup: (name: string) => groups.includes(name) });

describe('canUseExposedFields', () => {
  it('allows everyone when no group is set', () => {
    for (const group of [undefined, null, '', '   ']) {
      expect(canUseExposedFields(group, user([]))).toBe(true);
    }
  });

  it('allows only members of the configured group, by trimmed name', () => {
    expect(canUseExposedFields('Integrations', user(['Integrations']))).toBe(true);
    expect(canUseExposedFields(' Integrations ', user(['Integrations']))).toBe(true);
    expect(canUseExposedFields('Integrations', user(['Developers']))).toBe(false);
  });

  it('denies everyone when the configured group does not exist', () => {
    expect(canUseExposedFields('Integratoins', user(['Integrations']))).toBe(false);
  });
});
