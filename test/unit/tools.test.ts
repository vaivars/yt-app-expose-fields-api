import { beforeEach, describe, expect, it } from 'vitest';
import { aiTool as getIssueTool } from '../../src/backend/get-issue';
import { aiTool as updateIssueTool } from '../../src/backend/update-issue';
import type { AppSettings } from '../../src/core/types';
import { issueRegistry } from '../fakes/scripting-api/entities';
import { httpFake } from '../fakes/scripting-api/http';
import { fakeIssue, fakeUser, fakeYouTrack } from '../fakes/youtrack';

const PRIORITY = { name: 'Priority', value: { name: 'Major' }, $type: 'SingleEnumIssueCustomField' };
const EXTERNAL_ID = { name: 'External ID', value: 'X-9', $type: 'SimpleIssueCustomField' };
const BASE = { idReadable: 'ABC-1', summary: 'S', $type: 'Issue' };

function context(args: Record<string, unknown>, settings: AppSettings = {}, user = fakeUser()) {
  return {
    arguments: args,
    currentUser: user as never,
    settings: { exposedFields: 'External ID', serviceToken: 'perm:t', ...settings },
  };
}

beforeEach(() => {
  httpFake.reset();
  httpFake.respond = fakeYouTrack([PRIORITY, EXTERNAL_ID], BASE);
  issueRegistry.clear();
  issueRegistry.set('ABC-1', fakeIssue({ readable: ['Priority'] }));
});

describe('MCP tools', () => {
  it('declare their names, schemas and annotations', () => {
    expect([getIssueTool.name, updateIssueTool.name]).toEqual(['get_issue', 'update_issue']);
    expect(getIssueTool.annotations.readOnlyHint).toBe(true);
    expect(updateIssueTool.annotations.readOnlyHint).toBe(false);
    expect(updateIssueTool.annotations.destructiveHint).toBe(true);
    expect(getIssueTool.inputSchema.required).toEqual(['issueId']);
    expect(updateIssueTool.inputSchema.required).toEqual(['issueId', 'field']);
  });

  it('get_issue returns the ticket with readable and exposed fields', () => {
    expect(getIssueTool.execute(context({ issueId: ' ABC-1 ' }))).toEqual({
      idReadable: 'ABC-1',
      summary: 'S',
      customFields: [PRIORITY, EXTERNAL_ID],
      $type: 'Issue',
    });
  });

  it('get_issue returns only the named fields, given as a list or a comma-separated string', () => {
    const expected = { idReadable: 'ABC-1', customFields: [EXTERNAL_ID], $type: 'Issue' };
    expect(getIssueTool.execute(context({ issueId: 'ABC-1', fields: ['External ID', 42] }))).toEqual(expected);
    expect(getIssueTool.execute(context({ issueId: 'ABC-1', fields: 'external id' }))).toEqual(expected);
  });

  it('update_issue writes an exposed field, and clears it only with clear: true', () => {
    expect(updateIssueTool.execute(context({ issueId: 'ABC-1', field: 'External ID', value: 'NEW-1' }))).toEqual({
      idReadable: 'ABC-1',
      customFields: [{ ...EXTERNAL_ID, value: 'NEW-1' }],
      $type: 'Issue',
    });
    expect(updateIssueTool.execute(context({ issueId: 'ABC-1', field: 'External ID', clear: true }))).toEqual({
      idReadable: 'ABC-1',
      customFields: [{ ...EXTERNAL_ID, value: null }],
      $type: 'Issue',
    });
    expect(() => updateIssueTool.execute(context({ issueId: 'ABC-1', field: 'External ID' }))).toThrow(
      'bad_request: value is required; pass clear: true to clear the field',
    );
  });

  it('turn refusals into tool errors', () => {
    expect(() =>
      updateIssueTool.execute(context({ issueId: 'ABC-1', field: 'Priority', value: { name: 'Minor' } })),
    ).toThrow('forbidden: "Priority" is not an exposed field');
  });

  it('update_issue refuses callers without the update permission', () => {
    const reader = fakeUser('rita', [], ['READ_ISSUE']);
    const ctx = context({ issueId: 'ABC-1', field: 'External ID', value: 'x' }, {}, reader);
    expect(() => updateIssueTool.execute(ctx)).toThrow('forbidden: You are not allowed to update this issue');
    expect(httpFake.calls).toEqual([]);
  });

  it('report unknown, invisible, malformed or missing issues as not found without calling YouTrack', () => {
    issueRegistry.set('HIDDEN-1', fakeIssue({ id: 'HIDDEN-1', visible: false }));
    issueRegistry.set('BAD', new Error('Invalid issue id'));
    for (const tool of [getIssueTool, updateIssueTool]) {
      for (const issueId of ['NOPE-1', 'HIDDEN-1', 'BAD']) {
        expect(() => tool.execute(context({ issueId, field: 'External ID', value: 'x' }))).toThrow(
          `Issue "${issueId}" was not found`,
        );
      }
      expect(() => tool.execute(context({}))).toThrow('Issue "" was not found');
    }
    expect(httpFake.calls).toEqual([]);
  });
});
