import { namesArgument, type ToolContext, toolResult, visibleIssue } from '../adapters/tool';
import { readInput } from '../adapters/youtrack';
import { getIssue } from '../core/issue';

/** Published as hidden_fields_get_issue. */
export const aiTool = {
  name: 'get_issue',
  description:
    "Returns a YouTrack issue with every custom field you can read plus the fields this app exposes although they are hidden in the YouTrack UI. Pass `fields` to get only those custom fields. Same JSON shape as YouTrack's REST API.",
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'The issue ID, for example ABC-123.' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional custom field names. When given, only these fields are returned.',
      },
    },
    required: ['issueId'],
  },
  annotations: { title: 'Get an issue, including hidden fields', readOnlyHint: true },
  execute: (ctx: ToolContext) => {
    const issue = visibleIssue(ctx);
    return toolResult(getIssue(readInput(issue, ctx.currentUser, ctx.settings, namesArgument(ctx.arguments.fields))));
  },
};
