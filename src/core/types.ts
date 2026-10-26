/** One element of YouTrack's `GET /api/issues/{id}/customFields` response, passed through unchanged. */
export type CustomFieldEntry = Record<string, unknown>;

/** An issue in YouTrack's REST shape. */
export type IssueObject = Record<string, unknown>;

/** YouTrack's REST error shape. */
export interface ErrorBody {
  error: string;
  error_description: string;
}

export interface Result {
  status: number;
  body: IssueObject | ErrorBody;
}

/** The part of YouTrack's `http.Response` the app reads. */
export interface HttpResponseLike {
  code: number;
  response: string;
}

/** The part of YouTrack's `http.Connection` the app uses. */
export interface HttpConnectionLike {
  bearerAuth(token: string): unknown;
  addHeader(name: string, value: string): unknown;
  getSync(uri: string, queryParams: Record<string, string>): HttpResponseLike;
  postSync(uri: string, queryParams: Record<string, string>, payload: string): HttpResponseLike;
}

export interface UserLike {
  isInGroup(groupName: string): boolean;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

/** The app settings from `src/settings.json`. */
export interface AppSettings {
  exposedFields?: string | null;
  serviceToken?: string | null;
  /** Name of the group whose members may use exposed fields; blank means everyone who can read the issue. */
  allowedGroup?: string | null;
  youtrackUrl?: string | null;
  /** The interface switches; only `true` turns one off. */
  mcpDisabled?: boolean | null;
  attachedRestDisabled?: boolean | null;
  globalRestDisabled?: boolean | null;
}

/** What both operations need, already extracted from YouTrack objects by an adapter. */
export interface IssueContext {
  issueId: string;
  issueUrl: string;
  settings: AppSettings;
  user: UserLike;
  connect(baseUrl: string): HttpConnectionLike;
  /** Return YouTrack's full output instead of the compact default. */
  full?: boolean;
}

export interface ReadInput extends IssueContext {
  /** Requested custom field names; null or empty means the whole ticket. */
  names?: string[] | null;
  canRead(fieldName: string): boolean;
  projectFieldNames(): string[];
  log: Logger;
}

export interface UpdateInput extends IssueContext {
  /** Login of the caller, recorded in the app log because the issue history shows the technical user. */
  actor: string;
  field: unknown;
  /** The new YouTrack REST value; `undefined` means none was given, `null` clears the field. */
  value: unknown;
  canUpdate(): boolean;
  log: Logger;
}
