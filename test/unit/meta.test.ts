import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { httpHandler } from '../../src/backend/meta';
import { describeApi } from '../../src/core/openapi';
import type { AppSettings } from '../../src/core/types';
import { fakeResponse, fakeUser } from '../fakes/youtrack';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8')) as { version: string };
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

function serve(settings: AppSettings, user = fakeUser()) {
  const endpoint = httpHandler.endpoints[0];
  if (!endpoint) throw new Error('no endpoint');
  const response = fakeResponse();
  endpoint.handle({ currentUser: user, settings, response } as never);
  return response;
}

describe('meta httpHandler', () => {
  it('declares one app-wide GET endpoint at openapi.json', () => {
    expect(httpHandler.endpoints.map((endpoint) => [endpoint.method, endpoint.scope, endpoint.path])).toEqual([
      ['GET', 'global', 'openapi.json'],
    ]);
  });

  it('returns the description for the current REST switches', () => {
    for (const attached of [true, false]) {
      for (const global of [true, false]) {
        const settings: AppSettings = {
          ...(attached ? {} : { attachedRestDisabled: true }),
          ...(global ? {} : { globalRestDisabled: true }),
        };
        const response = serve(settings);
        expect(response.code).toBe(200);
        expect(response.body).toStrictEqual(describeApi(manifest.version, { attached, global }));
      }
    }
  });

  it('ships the same version as package.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it('reveals no other settings and nothing about the caller', () => {
    const bodies: unknown[] = [];
    for (const user of [fakeUser('jane'), fakeUser('root', ['group-zq'])]) {
      for (const settings of [
        {},
        {
          exposedFields: 'Secret Field Zq',
          serviceToken: 'perm:secret-zq',
          allowedGroup: { name: 'group-zq' },
          youtrackUrl: 'https://internal-zq.example',
          mcpDisabled: true,
        },
      ]) {
        bodies.push(serve(settings, user).body);
      }
    }
    for (const body of bodies) {
      expect(body).toStrictEqual(bodies[0]);
      expect(JSON.stringify(body)).not.toContain('zq');
    }
  });
});
