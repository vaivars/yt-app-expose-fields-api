import { assertMcpEnabled, namesArgument, type ToolContext, toolResult, visibleIssue } from '../adapters/tool';
import { readInput } from '../adapters/youtrack';
import { getIssue } from '../core/issue';

/** Published as hidden_fields_get_issue. */
export const aiTool = {
  name: 'get_issue',
  description:
    "Returns a YouTrack issue with every custom field you can read plus, if you're in the app's allowed group, the fields this app exposes although they are hidden in the YouTrack UI. Pass `fields` to get only those custom fields; names it can't return are listed in `missing`. YouTrack's REST JSON shape, compact by default: each field has its name and its value's text, name, login or presentation. Pass full: true for every attribute.",
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'The issue ID, for example ABC-123.' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional custom field names. When given, only these fields are returned.',
      },
      full: { type: 'boolean', description: "Set to true for YouTrack's full REST output instead of the compact one." },
    },
    required: ['issueId'],
  },
  annotations: { title: 'Get an issue, including hidden fields', readOnlyHint: true },
  execute: (ctx: ToolContext) => {
    assertMcpEnabled(ctx.settings);
    const issue = visibleIssue(ctx);
    const names = namesArgument(ctx.arguments.fields);
    return toolResult(getIssue(readInput(issue, ctx.currentUser, ctx.settings, names, ctx.arguments.full === true)));
  },
};
