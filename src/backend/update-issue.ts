import { type ToolContext, toolResult, visibleIssue } from '../adapters/tool';
import { updateInput } from '../adapters/youtrack';
import { updateIssue } from '../core/issue';

/** Published as hidden_fields_update_issue. */
export const aiTool = {
  name: 'update_issue',
  description:
    'Sets one custom field that this app exposes (hidden in the YouTrack UI) on a YouTrack issue. `value` uses YouTrack\'s REST format for the field type: a string for string fields, {"text": "…"} for text, {"name": "…"} for enum/state/version, {"login": "…"} for user fields. Pass clear: true instead of value to empty the field.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'The issue ID, for example ABC-123.' },
      field: { type: 'string', description: 'The name of an exposed custom field.' },
      value: { description: "The new value in YouTrack's REST format for the field type." },
      clear: { type: 'boolean', description: 'Set to true to empty the field instead of passing a value.' },
    },
    required: ['issueId', 'field'],
  },
  annotations: { title: 'Update a hidden field', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  execute: (ctx: ToolContext) => {
    const issue = visibleIssue(ctx);
    const value = ctx.arguments.clear === true ? null : ctx.arguments.value;
    if (value === undefined) throw new Error('bad_request: value is required; pass clear: true to clear the field');
    return toolResult(updateIssue(updateInput(issue, ctx.currentUser, ctx.settings, ctx.arguments.field, value)));
  },
};
