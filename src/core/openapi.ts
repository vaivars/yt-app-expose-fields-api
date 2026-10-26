/** Which REST endpoints are switched on, and so listed. */
export interface RestSwitches {
  /** `/api/issues/{id}/extensionEndpoints/hidden-fields/api/issue`, in projects the app is attached to. */
  attached: boolean;
  /** `/api/extensionEndpoints/hidden-fields/global/issue`, in every project. */
  global: boolean;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  description: string;
  schema: { type: 'string' };
  'x-youtrack-entity'?: 'issue';
}

export interface Operation {
  operationId: string;
  summary: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

export interface PathItem {
  /** The YouTrack endpoint scope: `issue` endpoints only work in projects the app is attached to. */
  'x-youtrack-scope': 'global' | 'issue';
  description: string;
  parameters: Parameter[];
  get: Operation;
  post: Operation;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string; 'x-youtrack-app': { id: string } };
  servers: { url: string; description: string }[];
  security: Record<string, string[]>[];
  paths: Record<string, PathItem>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
}

const GLOBAL_PATH = '/api/extensionEndpoints/hidden-fields/global/issue';
const ATTACHED_PATH = '/api/issues/{id}/extensionEndpoints/hidden-fields/api/issue';

const INFO_DESCRIPTION = [
  'Reads and updates YouTrack custom fields that are hidden from the YouTrack UI.',
  'The app calls YouTrack as a technical user that can see those fields, and returns only what the caller may get.',
  'Compatibility: released paths, parameters, operation ids, response fields and error codes are only ever added to,',
  "never renamed or removed, so ignore what you don't recognise. A breaking change gets a new path.",
  'An endpoint switched off in the app settings drops out of this document and answers 403 with error `disabled`.',
].join(' ');

const READ_VALUE = [
  'Compact by default: the one attribute that identifies the value. `text` for text fields; `name` for enums, states,',
  'versions, builds, groups and owned fields; `login` for users; `presentation` for periods. Strings, numbers and',
  'dates (milliseconds since 1970) come as they are, multi-value fields as a list, and an empty field as null.',
  'With full=true, every attribute YouTrack returns.',
].join(' ');

const WRITE_VALUE = [
  'The value in YouTrack\'s REST format for the field type: a string for string fields; {"text": "…"} for text;',
  '{"name": "Major"} for enum, state, version, build and owned fields (a list for multi-value fields);',
  '{"login": "jane"} for users; a number for integer and float; milliseconds since 1970 for dates;',
  '{"presentation": "1d 2h"} for periods. null clears the field.',
].join(' ');

function ref(name: string): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

function json(schema: unknown): Record<string, unknown> {
  return { 'application/json': { schema } };
}

function error(description: string): Record<string, unknown> {
  return { description, content: json(ref('Error')) };
}

function query(name: string, description: string, required = false): Parameter {
  return { name, in: 'query', required, description, schema: { type: 'string' } };
}

const FIELDS = query(
  'fields',
  'Custom field names, separated by commas; put a name that contains a comma in double quotes. Matching ignores case ' +
    "and surrounding spaces. Only these fields are returned, and names that don't come back are listed in `missing`. " +
    'Without it, the whole issue is returned.',
);

const FULL = query(
  'full',
  '`true` returns every attribute YouTrack returns instead of the compact shape. Case-insensitive; any other value means compact.',
);

const ISSUE_ID: Parameter = {
  ...query('issueId', 'The issue ID: readable, like ABC-1, or the database ID.', true),
  'x-youtrack-entity': 'issue',
};

const ID: Parameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The issue ID: readable, like ABC-1, or the database ID.',
  schema: { type: 'string' },
  'x-youtrack-entity': 'issue',
};

const UNAUTHORIZED = error('No token, or an invalid one. YouTrack answers this itself, before the app runs.');
const CONFIGURATION = error("`configuration_error`: the app's settings can't produce a YouTrack URL.");
const UPSTREAM = error(
  "`upstream_error`: the technical user's call to YouTrack failed or returned an unexpected body.",
);

function operations(appWide: boolean): Pick<PathItem, 'get' | 'post'> {
  const suffix = appWide ? '' : '-attached';
  const missingId = appWide ? '`issueId` is missing, or ' : '';
  return {
    get: {
      operationId: `get-issue${suffix}`,
      summary: 'Get an issue, including hidden fields',
      description:
        "The issue in YouTrack's REST shape, with every custom field you can read plus the fields this app exposes " +
        "although YouTrack hides them. Entries come in YouTrack's field order; match them by `name`.",
      parameters: [FIELDS, FULL],
      responses: {
        '200': { description: 'The issue.', content: json(ref('Issue')) },
        '400': error(`\`bad_request\`: ${missingId}YouTrack rejected the request; its error is passed through.`),
        '401': UNAUTHORIZED,
        '403': error('`disabled`: this endpoint is turned off in the app settings.'),
        '404': error("`not_found`: the issue doesn't exist, or you can't see it."),
        '500': CONFIGURATION,
        '502': UPSTREAM,
      },
    },
    post: {
      operationId: `update-issue${suffix}`,
      summary: 'Set one exposed field',
      description:
        'Sets one custom field on the exposed list, as the technical user, so the issue history shows that user. ' +
        'You need permission to update the issue.',
      parameters: [FULL],
      requestBody: { required: true, content: json(ref('UpdateRequest')) },
      responses: {
        '200': {
          description: 'A short status; with full=true, the updated field in the shape of get-issue with `fields`.',
          content: json({ oneOf: [ref('UpdateStatus'), ref('Issue')] }),
        },
        '400': error(
          `\`bad_request\`: ${missingId}the body isn't {"field": …, "value": …}, or YouTrack rejected the value; ` +
            'its error is passed through.',
        ),
        '401': UNAUTHORIZED,
        '403': error(
          '`disabled`: this endpoint is turned off in the app settings. `forbidden`: you are not in the allowed ' +
            "group, can't update the issue, or the field isn't exposed.",
        ),
        '404': error("`not_found`: the issue doesn't exist or you can't see it, or the field isn't on this issue."),
        '415': error('`unsupported_media_type`: send the body as application/json.'),
        '500': CONFIGURATION,
        '502': UPSTREAM,
      },
    },
  };
}

const SCHEMAS: Record<string, unknown> = {
  Error: {
    type: 'object',
    required: ['error', 'error_description'],
    properties: {
      error: {
        type: 'string',
        description:
          "The app's codes are bad_request, disabled, forbidden, not_found, unsupported_media_type, " +
          "configuration_error and upstream_error; errors from YouTrack itself keep YouTrack's own code.",
      },
      error_description: { type: 'string' },
    },
  },
  Issue: {
    type: 'object',
    description:
      "An issue in YouTrack's REST shape. With `fields`, it has only idReadable, customFields and, when a name " +
      "didn't come back, missing.",
    required: ['$type'],
    properties: {
      idReadable: { type: 'string' },
      summary: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      created: { type: 'integer', description: 'Milliseconds since 1970.' },
      updated: { type: 'integer', description: 'Milliseconds since 1970.' },
      resolved: { type: ['integer', 'null'], description: 'Milliseconds since 1970, or null.' },
      reporter: { type: ['object', 'null'], description: 'Compact: only the login.' },
      project: { type: 'object', description: 'Compact: only the shortName.' },
      customFields: { type: 'array', items: ref('CustomField') },
      missing: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Requested names that didn't come back, as given. A field that doesn't exist and one you may not get look " +
          'the same.',
      },
      $type: { type: 'string' },
    },
  },
  CustomField: {
    type: 'object',
    required: ['name', '$type'],
    properties: {
      name: { type: 'string' },
      value: { description: READ_VALUE },
      $type: { type: 'string' },
    },
  },
  UpdateRequest: {
    type: 'object',
    required: ['field', 'value'],
    properties: {
      field: { type: 'string', description: 'The name of an exposed custom field.' },
      value: { description: WRITE_VALUE },
    },
  },
  UpdateStatus: {
    type: 'object',
    required: ['idReadable', 'field', 'status'],
    properties: {
      idReadable: { type: 'string' },
      field: { type: 'string', description: "The field's name as YouTrack spells it." },
      status: { type: 'string', description: '`updated`.' },
    },
  },
};

/** The OpenAPI description of the switched-on REST endpoints. It holds no data and no other settings. */
export function describeApi(version: string, rest: RestSwitches): OpenApiDocument {
  const paths: Record<string, PathItem> = {};
  if (rest.global) {
    paths[GLOBAL_PATH] = {
      'x-youtrack-scope': 'global',
      description:
        "Works in every project you and the app's technical user can read, whether or not the app is attached to it.",
      parameters: [ISSUE_ID],
      ...operations(true),
    };
  }
  if (rest.attached) {
    paths[ATTACHED_PATH] = {
      'x-youtrack-scope': 'issue',
      description:
        'Works only in projects the app is attached to; elsewhere YouTrack answers 404 "HTTP handler not found" ' +
        'before the app runs.',
      parameters: [ID],
      ...operations(false),
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Hidden Fields API',
      version,
      description: INFO_DESCRIPTION,
      'x-youtrack-app': { id: 'hidden-fields' },
    },
    servers: [{ url: '../../../..', description: 'The YouTrack base URL, relative to this document' }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'A YouTrack permanent token' } },
      schemas: SCHEMAS,
    },
  };
}
