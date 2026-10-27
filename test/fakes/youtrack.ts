export interface FakeUser {
  login: string;
  isInGroup(name: string): boolean;
  hasPermission(key: string, project?: unknown): boolean;
}

export function fakeUser(
  login = 'jane',
  groups: string[] = [],
  permissions = ['READ_ISSUE', 'UPDATE_ISSUE'],
): FakeUser {
  return {
    login,
    isInGroup: (name) => groups.includes(name),
    hasPermission: (key, project) => project !== undefined && permissions.includes(key),
  };
}

export interface FakeIssueOptions {
  id?: string;
  readable?: string[];
  projectFields?: string[];
  visible?: boolean;
}

export function fakeIssue(options: FakeIssueOptions = {}) {
  const id = options.id ?? 'ABC-1';
  const readable = new Set(options.readable ?? []);
  const projectFields = options.projectFields ?? [];
  return {
    id,
    url: `https://yt.example/issue/${id}`,
    fields: { canBeReadBy: (name: string, _user: FakeUser) => readable.has(name) },
    project: {
      shortName: 'ABC',
      fields: {
        forEach: (visit: (field: { name: string }) => void) => {
          for (const name of projectFields) visit({ name });
        },
      },
    },
    isVisibleTo: (_user: FakeUser) => options.visible ?? true,
  };
}

/** A request whose body, like YouTrack's, can be read only once. */
export function fakeRequest(params: Record<string, string> = {}, body = '', headers: Record<string, string> = {}) {
  let unread = true;
  return {
    getParameter: (name: string): string | undefined => params[name],
    // Like YouTrack's runtime: headers are a list of {name, value}; there is no getHeader().
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    get body(): string {
      const value = unread ? body : '';
      unread = false;
      return value;
    },
  };
}

export function fakeResponse() {
  return {
    code: 200,
    body: undefined as unknown,
    json(data: unknown): void {
      this.body = data;
    },
  };
}

/** Answers like YouTrack for one issue: customFields, the issue with its custom fields, and field updates. */
export function fakeYouTrack(fields: Record<string, unknown>[], base: Record<string, unknown>) {
  let current = fields;
  return (method: string, uri: string, payload?: string) => {
    if (method === 'POST') {
      const update = (JSON.parse(payload ?? '{}') as { customFields: { name: string; value: unknown }[] })
        .customFields[0];
      current = current.map((entry) => (entry.name === update?.name ? { ...entry, value: update.value } : entry));
      return { code: 200, response: JSON.stringify({ idReadable: 'ABC-1', customFields: current, $type: 'Issue' }) };
    }
    if (uri.endsWith('/customFields')) return { code: 200, response: JSON.stringify(current) };
    return { code: 200, response: JSON.stringify({ ...base, customFields: current }) };
  };
}
