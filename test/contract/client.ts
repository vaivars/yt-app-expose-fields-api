import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Switch } from '../../src/core/switches.ts';
import { contractEnv as env } from './env.ts';

export type Entry = Record<string, unknown> & { name?: string };

/** GET a YouTrack REST path as the token's user. `fields` is added as a query parameter when given. */
export async function get<T>(token: string, path: string, fields?: string): Promise<{ status: number; body: T }> {
  const query = fields === undefined ? '' : `${path.includes('?') ? '&' : '?'}fields=${encodeURIComponent(fields)}`;
  const response = await fetch(`${env.url}${path}${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

/** POST a JSON body to a YouTrack REST path as the token's user; `contentType` overrides the JSON content type. */
export async function post<T>(
  token: string,
  path: string,
  body: unknown,
  contentType = 'application/json',
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${env.url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': contentType },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

/** Puts a string field of the test issue back to its fixture value, as the technical user. */
export async function restoreStringField(name: string, value: string): Promise<void> {
  const { status } = await post(env.techToken, `/api/issues/${env.issue}?fields=idReadable`, {
    customFields: [{ name, $type: 'SimpleIssueCustomField', value }],
  });
  if (status !== 200) throw new Error(`could not restore ${name}: HTTP ${status}`);
}

/** The app's recent log lines, as the CLI prints them. */
export function appLogs(): string {
  return execFileSync('youtrack-app', ['app', 'logs', '--app', 'hidden-fields', '--limit', '50'], {
    encoding: 'utf8',
    env: { ...process.env, YOUTRACK_HOST: env.url, YOUTRACK_TOKEN: env.adminToken },
  });
}

/** Runs the youtrack-app CLI as admin. Credentials go through the environment, never argv, so errors can't print them. */
export function cli(...args: string[]): void {
  execFileSync('youtrack-app', args, {
    stdio: 'inherit',
    env: { ...process.env, YOUTRACK_HOST: env.url, YOUTRACK_TOKEN: env.adminToken },
  });
}

/**
 * Writes the app's global settings over REST (no CLI, so tokens never reach argv). `allowedGroup` names the group whose
 * members may use the exposed fields; null leaves it unset, which turns the app off. Switches left out aren't written,
 * as for an app saved before they existed.
 */
export async function appSettings(
  allowedGroup: string | null = env.everyone,
  switches: Partial<Record<Switch, boolean>> = {},
): Promise<void> {
  const settings: Record<string, unknown> = {
    exposedFields: env.exposed.join(','),
    serviceToken: env.techToken,
    youtrackUrl: env.selfUrl,
    ...switches,
  };
  if (allowedGroup !== null) settings.allowedGroup = { id: await groupId(allowedGroup) };
  const apps = await get<{ id: string; name: string }[]>(env.adminToken, '/api/admin/apps?$top=-1', 'id,name');
  const app = apps.body.find((candidate) => candidate.name === 'hidden-fields');
  if (!app) throw new Error('the hidden-fields app is not installed');
  const { status } = await post(env.adminToken, `/api/admin/apps/${app.id}/globalConfig?fields=id`, {
    globalSettings: JSON.stringify(settings),
  });
  if (status !== 200) throw new Error(`could not write the app settings: HTTP ${status}`);
}

async function groupId(name: string): Promise<string> {
  const { body } = await get<{ id: string; name: string }[]>(env.adminToken, '/api/groups?$top=-1', 'id,name');
  const group = body.find((candidate) => candidate.name === name);
  if (!group) throw new Error(`no group named ${name}`);
  return group.id;
}

/** Calls one of the app's MCP tools as the token's user with a fresh connection; returns the raw text result. */
export async function callToolRaw(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const client = new Client({ name: 'hidden-fields-contract', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${env.url}/mcp?customToolPackages=hidden-fields`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { isError: result.isError === true, text: content[0]?.text ?? '' };
  } finally {
    await client.close();
  }
}

/** Calls one of the app's MCP tools and returns the parsed JSON result; fails on a tool error. */
export async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { isError, text } = await callToolRaw(token, name, args);
  if (isError) throw new Error(`tool ${name} failed: ${text}`);
  return JSON.parse(text);
}
