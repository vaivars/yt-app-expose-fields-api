import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { aiTool as getIssueTool } from '../../src/backend/get-issue';
import { aiTool as updateIssueTool } from '../../src/backend/update-issue';
import { disabled, isEnabled, type Switch } from '../../src/core/switches';
import type { AppSettings } from '../../src/core/types';
import { callAttached, callGlobal, resetYouTrack } from '../fakes/handlers';
import { issueRegistry } from '../fakes/scripting-api/entities';
import { httpFake } from '../fakes/scripting-api/http';
import { fakeIssue, fakeUser } from '../fakes/youtrack';

const TITLES: Record<Switch, string> = {
  mcpEnabled: 'MCP tools',
  attachedRestEnabled: 'REST endpoints in attached projects',
  globalRestEnabled: 'App-wide REST endpoints',
};
const SWITCHES = Object.keys(TITLES) as Switch[];
const UPDATE = '{"field":"External ID","value":"X"}';
const MCP_OFF = 'disabled: The MCP tools are turned off in the app settings';

function settings(overrides: AppSettings = {}): AppSettings {
  return { exposedFields: 'External ID', serviceToken: 'perm:t', ...overrides };
}

function toolContext(issueId: string, overrides: AppSettings = {}) {
  return {
    arguments: { issueId, field: 'External ID', value: 'X' },
    currentUser: fakeUser() as never,
    settings: settings(overrides),
  };
}

beforeEach(() => {
  resetYouTrack();
  issueRegistry.clear();
  issueRegistry.set('ABC-1', fakeIssue({ readable: ['Priority'] }));
});

describe('switches', () => {
  it('treats a missing or null switch as on', () => {
    for (const key of SWITCHES) {
      expect(isEnabled({}, key), key).toBe(true);
      expect(isEnabled({ [key]: null }, key), key).toBe(true);
      expect(isEnabled({ [key]: true }, key), key).toBe(true);
      expect(isEnabled({ [key]: false }, key), key).toBe(false);
    }
  });

  it('declares the switches as global booleans that default to on', () => {
    const schema = JSON.parse(readFileSync('src/settings.json', 'utf8')) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    for (const key of SWITCHES) {
      expect(schema.properties[key], key).toMatchObject({
        type: 'boolean',
        default: true,
        'x-scope': 'GLOBAL',
        title: TITLES[key],
      });
    }
    expect(schema.required).toEqual(['exposedFields', 'serviceToken']);
  });

  it('answers the same 403 for existing, unknown and missing issues', () => {
    for (const method of ['GET', 'POST']) {
      for (const visible of [true, false]) {
        const response = callAttached(method, {
          body: UPDATE,
          issue: fakeIssue({ visible }),
          settings: settings({ attachedRestEnabled: false }),
        });
        expect(response.code, `${method} visible=${visible}`).toBe(403);
        expect(response.body).toEqual(disabled('attachedRestEnabled').body);
      }
      for (const issueId of ['ABC-1', 'NOPE-1', null]) {
        const response = callGlobal(method, {
          issueId,
          body: UPDATE,
          settings: settings({ globalRestEnabled: false }),
        });
        expect(response.code, `${method} ${issueId}`).toBe(403);
        expect(response.body).toEqual(disabled('globalRestEnabled').body);
      }
    }
    expect(disabled('attachedRestEnabled').body).toEqual({
      error: 'disabled',
      error_description: 'The REST endpoints in attached projects are turned off in the app settings',
    });
    expect(disabled('globalRestEnabled').body).toEqual({
      error: 'disabled',
      error_description: 'The app-wide REST endpoints are turned off in the app settings',
    });
    expect(httpFake.calls).toEqual([]);
  });

  it('refuses MCP calls when MCP is off', () => {
    for (const tool of [getIssueTool, updateIssueTool]) {
      for (const issueId of ['ABC-1', 'NOPE-1']) {
        expect(() => tool.execute(toolContext(issueId, { mcpEnabled: false }))).toThrow(MCP_OFF);
      }
    }
    expect(httpFake.calls).toEqual([]);
  });

  it('leaves the other interfaces alone', () => {
    for (const key of SWITCHES) {
      const off = settings({ [key]: false });
      if (key !== 'attachedRestEnabled') expect(callAttached('GET', { settings: off }).code, key).toBe(200);
      if (key !== 'globalRestEnabled') expect(callGlobal('GET', { settings: off }).code, key).toBe(200);
      if (key !== 'mcpEnabled') {
        expect(getIssueTool.execute(toolContext('ABC-1', { [key]: false })), key).toMatchObject({
          idReadable: 'ABC-1',
        });
      }
    }
  });
});
