import { httpHandler as attachedHandler } from '../../src/backend/api';
import { httpHandler as globalHandler } from '../../src/backend/global';
import type { AppSettings, HttpResponseLike } from '../../src/core/types';
import { issueRegistry } from './scripting-api/entities';
import { httpFake } from './scripting-api/http';
import { type FakeUser, fakeIssue, fakeRequest, fakeResponse, fakeUser, fakeYouTrack } from './youtrack';

export const PRIORITY = { name: 'Priority', value: { name: 'Major' }, $type: 'SingleEnumIssueCustomField' };
export const EXTERNAL_ID = { name: 'External ID', value: 'X-9', $type: 'SimpleIssueCustomField' };
export const BASE = { idReadable: 'ABC-1', summary: 'S', $type: 'Issue' };

type Respond = (method: string, uri: string, payload?: string) => HttpResponseLike;

export interface CallOptions {
  params?: Record<string, string>;
  body?: string;
  /** Defaults to application/json; null sends no Content-Type. */
  contentType?: string | null;
  settings?: AppSettings;
  user?: FakeUser;
  issue?: ReturnType<typeof fakeIssue>;
}

export interface GlobalCallOptions extends CallOptions {
  /** Defaults to the issue's id; null leaves the parameter out. */
  issueId?: string | null;
}

export interface Call {
  code: number;
  body: unknown;
  /** The query parameter names the handler asked for. */
  asked: string[];
}

function defaultSettings(): AppSettings {
  return { exposedFields: 'External ID', serviceToken: 'perm:t' };
}

export function resetYouTrack(respond: Respond = fakeYouTrack([PRIORITY, EXTERNAL_ID], BASE)): void {
  httpFake.reset();
  httpFake.respond = respond;
}

function request(options: CallOptions, params: Record<string, string>, asked: string[]) {
  const headers: Record<string, string> =
    options.contentType === null ? {} : { 'Content-Type': options.contentType ?? 'application/json' };
  const fake = fakeRequest(params, options.body, headers);
  const getParameter = fake.getParameter;
  fake.getParameter = (name) => {
    asked.push(name);
    return getParameter(name);
  };
  return fake;
}

function endpoint<T extends { method: string }>(endpoints: T[], method: string): T {
  const found = endpoints.find((candidate) => candidate.method === method);
  if (!found) throw new Error(`no ${method} endpoint`);
  return found;
}

/** Calls the per-project endpoint, as YouTrack does for an issue in an attached project. */
export function callAttached(method: string, options: CallOptions = {}): Call {
  const asked: string[] = [];
  const response = fakeResponse();
  endpoint(attachedHandler.endpoints, method).handle({
    issue: (options.issue ?? fakeIssue({ readable: ['Priority'] })) as never,
    currentUser: (options.user ?? fakeUser()) as never,
    settings: options.settings ?? defaultSettings(),
    request: request(options, options.params ?? {}, asked),
    response,
  });
  return { code: response.code, body: response.body, asked };
}

/** Calls the app-wide endpoint with `issueId`, after registering the issue so findById finds it. */
export function callGlobal(method: string, options: GlobalCallOptions = {}): Call {
  const issue = options.issue ?? fakeIssue({ readable: ['Priority'] });
  issueRegistry.set(issue.id, issue);
  const issueId = options.issueId === undefined ? issue.id : options.issueId;
  const params = { ...(issueId === null ? {} : { issueId }), ...options.params };
  const asked: string[] = [];
  const response = fakeResponse();
  endpoint(globalHandler.endpoints, method).handle({
    currentUser: (options.user ?? fakeUser()) as never,
    settings: options.settings ?? defaultSettings(),
    request: request(options, params, asked),
    response,
  });
  return { code: response.code, body: response.body, asked };
}

const UPDATE = '{"field":"External ID","value":"X"}';
const NO_BASE_URL = { ...fakeIssue({ readable: ['Priority'] }), url: 'https://yt.example/x/ABC-1' };
const UPSTREAM_400: Respond = () => ({ code: 400, response: '{"error":"bad_request","error_description":"x"}' });
const UPSTREAM_500: Respond = () => ({ code: 500, response: '' });

/** One request per status and branch both REST endpoints share. */
export const SCENARIOS: { name: string; method: 'GET' | 'POST'; options: CallOptions; respond?: Respond }[] = [
  { name: 'compact', method: 'GET', options: {} },
  { name: 'full', method: 'GET', options: { params: { full: 'true' } } },
  { name: 'named fields', method: 'GET', options: { params: { fields: 'Priority, Nope' } } },
  {
    name: 'allowed group, non-member',
    method: 'GET',
    options: { settings: { ...defaultSettings(), allowedGroup: 'staff' } },
  },
  { name: 'upstream 400', method: 'GET', options: {}, respond: UPSTREAM_400 },
  { name: 'invisible', method: 'GET', options: { issue: fakeIssue({ visible: false }) } },
  { name: 'no base URL', method: 'GET', options: { issue: NO_BASE_URL } },
  { name: 'upstream 500', method: 'GET', options: {}, respond: UPSTREAM_500 },
  { name: 'update', method: 'POST', options: { body: UPDATE } },
  { name: 'update, full', method: 'POST', options: { body: UPDATE, params: { full: 'true' } } },
  { name: 'bad body', method: 'POST', options: { body: 'not json' } },
  { name: 'not exposed', method: 'POST', options: { body: '{"field":"Priority","value":null}' } },
  {
    name: 'no update permission',
    method: 'POST',
    options: { body: UPDATE, user: fakeUser('rita', [], ['READ_ISSUE']) },
  },
  {
    name: 'allowed group, non-member',
    method: 'POST',
    options: { body: UPDATE, settings: { ...defaultSettings(), allowedGroup: 'staff' } },
  },
  {
    name: 'field not on issue',
    method: 'POST',
    options: {
      body: '{"field":"Ghost","value":null}',
      settings: { ...defaultSettings(), exposedFields: 'External ID, Ghost' },
    },
  },
  { name: 'not JSON', method: 'POST', options: { body: UPDATE, contentType: 'text/plain' } },
  { name: 'invisible', method: 'POST', options: { body: UPDATE, issue: fakeIssue({ visible: false }) } },
  { name: 'no base URL', method: 'POST', options: { body: UPDATE, issue: NO_BASE_URL } },
  { name: 'upstream 500', method: 'POST', options: { body: UPDATE }, respond: UPSTREAM_500 },
];
