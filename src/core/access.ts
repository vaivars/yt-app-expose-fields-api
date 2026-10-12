import type { UserLike } from './types';

/**
 * Whether the user may read exposed fields: always when no group name is configured, otherwise only members.
 * The group is configured by name because MCP tools see entity settings with the caller's permissions, where a
 * non-member would see no group at all. A name that matches no group denies everyone.
 */
export function canUseExposedFields(allowedGroup: string | null | undefined, user: UserLike): boolean {
  const name = allowedGroup?.trim() ?? '';
  if (name === '') return true;
  return user.isInGroup(name);
}
