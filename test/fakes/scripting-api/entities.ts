/** Issues findable by id; an Error value makes findById throw it. */
export const issueRegistry = new Map<string, unknown>();

export const Issue = {
  findById(id: string): unknown {
    const found = issueRegistry.get(id);
    if (found instanceof Error) throw found;
    return found ?? null;
  },
};
