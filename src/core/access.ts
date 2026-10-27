import type { GroupLike, UserLike } from './types';

/**
 * Whether the user may use exposed fields: only members of the allowed group, and nobody while no group is set. MCP
 * tools see the group with the caller's permissions, so a caller who can't see it gets no group and is refused too.
 */
export function canUseExposedFields(allowedGroup: GroupLike | null | undefined, user: UserLike): boolean {
  const name = allowedGroup?.name;
  return typeof name === 'string' && name !== '' && user.isInGroup(name);
}
