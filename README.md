# Hidden Fields API for YouTrack

YouTrack can't hide a custom field from the UI only. If you keep integration metadata in issue fields, every user sees it on every issue. That metadata might be external IDs, sync state, or hints for tools and AI agents.

This app is the workaround. Make those fields visible only to a technical group, so YouTrack hides them from everyone else. The app then lets people and agents read the issue together with those fields, and update them, through:

- REST endpoints, in YouTrack's own JSON format: app-wide ones that work in every project, and per-project ones for projects the app is attached to;
- tools in YouTrack's built-in MCP server.

An OpenAPI description of the REST endpoints lets clients use them without app-specific code.

A typical use: an AI agent keeps its session state in a hidden text field, so whoever picks up the issue next can continue where it left off, without any human seeing that state in the UI.

Requires YouTrack 2026.2 or newer.

## How it works

The app holds a permanent token of a technical user who can see the hidden fields. In YouTrack, "Visible to" stops everyone outside the group from reading a field, and everyone but administrators from updating it, so the app does both on the caller's behalf:

1. It checks that the caller can see the issue (and, for updates, may update it).
2. It calls YouTrack's own REST API as the technical user.
3. It returns only what the caller may get, and updates only the exposed fields.

## Set up

1. **Create a group**, for example `hidden-fields-readers`.
2. **Create a technical user** and add it to the group.
   - Give it read access to issues in the projects that use hidden fields, plus **Update Issue** if callers should update exposed fields. Never make it an administrator.
   - It must be able to read every custom field in those projects, or `get_issue` misses fields (see [Troubleshooting](#troubleshooting)).
   - The app only works in projects this user can read, so its project access is how you choose where the app works.
   - Create a permanent token for it: Profile → Account Security → New token, with scope YouTrack.
3. **Hide the fields.** In each project, open Fields, select the field, and under Advanced settings set **Visible to** to the group.
4. **Install the app.** Install it from JetBrains Marketplace, or upload `hidden-fields-<version>.zip` from a [GitHub release](https://github.com/vaivars/yt-app-expose-fields-api/releases) under Administration → Apps.
5. **Fill in the settings** (Administration → Apps → Hidden Fields API → Settings):

   | Setting | Value |
   |---|---|
   | Exposed fields | Field names separated by commas. Put a name that contains a comma in double quotes: `External ID, "Fix versions, legacy"` |
   | Technical user token | The permanent token from step 2 |
   | Allowed group | Optional: the name of a group. Only its members can read and update the exposed fields; if no group has that name, nobody can. |
   | YouTrack base URL | Optional: set it if YouTrack can't reach itself at the URL in issue links |
   | MCP tools | On by default. Turn off to refuse every call to the MCP tools |
   | REST endpoints in attached projects | On by default. Turn off to refuse the per-project URLs |
   | App-wide REST endpoints | On by default. Turn off to refuse the app-wide URLs |

6. **Optional: attach the app** to projects where you want the per-project URLs. The app-wide URLs and the MCP tools work without it.

### Choose the interfaces

Each interface has its own switch in the settings, and all are on by default:

- **MCP only:** turn off both REST switches.
- **REST tied to attachment:** turn off App-wide REST endpoints. REST then works only in projects the app is attached to.
- **App-wide REST only:** turn off REST endpoints in attached projects.

A switched-off REST endpoint answers `403` with error `disabled`, and a switched-off MCP tool returns an error.

## Use it

### Read: get_issue

```
GET /api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1
GET /api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1&fields=Priority,LLM Session
GET /api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1&full=true
```

`issueId` is the readable ID or the database ID. These URLs work in every project you and the technical user can read. In projects the app is attached to, you can also use the per-project URL, which takes the same parameters and answers the same way:

```
GET /api/issues/ABC-1/extensionEndpoints/hidden-fields/api/issue?fields=Priority
```

Without `fields`, you get the issue in YouTrack's REST shape: `idReadable`, `summary`, `description`, `created`, `updated`, `resolved`, `reporter`, `project`, and `customFields` with every custom field you can read plus the exposed hidden ones.

The response is compact, to keep it small for AI agents. Each custom field has its `name` and the one attribute that identifies its value:

- `text` for text fields;
- `name` for enums, states, versions, builds, groups and owned fields;
- `login` for users;
- `presentation` for periods;
- strings, numbers and dates come as they are.

The reporter has only its `login` and the project only its `shortName`.

```json
{"idReadable":"ABC-1","summary":"…","description":"…","created":1797000000000,"updated":1797000000000,"resolved":null,
 "reporter":{"login":"jane","$type":"User"},"project":{"shortName":"ABC","$type":"Project"},
 "customFields":[{"name":"Priority","value":{"name":"Major","$type":"EnumBundleElement"},"$type":"SingleEnumIssueCustomField"},
                 {"name":"LLM Session","value":{"text":"…","$type":"TextFieldValue"},"$type":"TextIssueCustomField"}],
 "$type":"Issue"}
```

Add `full=true` to get every attribute YouTrack returns: field ids and types, rendered text as HTML (`markdownText`), user names, colours and so on.

`fields` is a list of custom field **names**, separated by commas; quote a name that contains a comma. Then you get only those fields:

```json
{"idReadable":"ABC-1","customFields":[{"name":"Priority",…},{"name":"LLM Session",…}],"$type":"Issue"}
```

Names that don't come back are listed in `missing`, as you wrote them, and the key appears only when something is missing:

```json
{"idReadable":"ABC-1","customFields":[{"name":"Priority",…}],"missing":["LLM Sesion"],"$type":"Issue"}
```

`missing` doesn't say why a field is absent: a field that doesn't exist and a field you aren't allowed to get look the same, so the answer doesn't reveal hidden fields. Matching ignores case and surrounding spaces. YouTrack checks the `fields` syntax itself, on both URLs, and answers `400` for some names with parentheses, such as one with an unbalanced or leading parenthesis; use MCP for those.

Entries come in YouTrack's field order as the technical user sees it, which can differ slightly from your own calls. Match entries by `name`, not by position.

### Write: update_issue

```
POST /api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1
{"field": "LLM Session", "value": {"text": "…"}}
```

In projects the app is attached to, `POST /api/issues/ABC-1/extensionEndpoints/hidden-fields/api/issue` does the same.

Sets one exposed field. `value` is what YouTrack's REST API expects for the field type:

| Field type | `value` |
|---|---|
| string | `"EXT-42"` |
| text | `{"text": "…"}` |
| enum, state, version, build, owned | `{"name": "Major"}` (multi-value fields: a list) |
| user | `{"login": "jane"}` |
| integer, float | a number |
| date | milliseconds since 1970 |
| period | `{"presentation": "1d 2h"}` |
| any | `null` clears the field |

The response is a short status, `{"idReadable":"ABC-1","field":"LLM Session","status":"updated"}`. Add `?full=true` to the URL to get the updated field back instead, in the same shape as `get_issue` with `fields` and `full=true`. Only fields on the exposed list can be set; everything else goes through YouTrack's own API. You need permission to update the issue (and to be in **Allowed group**, if set). The change is made by the technical user, so the issue history shows that user as its author. Only members of the field's "Visible to" group see that history entry.

```sh
curl -H "Authorization: Bearer $YOUTRACK_TOKEN" \
  "https://youtrack.example.com/api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1&fields=LLM%20Session"

curl -X POST -H "Authorization: Bearer $YOUTRACK_TOKEN" -H "Content-Type: application/json" \
  -d '{"field":"LLM Session","value":{"text":"summary of where I stopped"}}' \
  "https://youtrack.example.com/api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1"
```

### Describe: openapi.json

```
GET /api/extensionEndpoints/hidden-fields/meta/openapi.json
```

An OpenAPI 3.1 description of the REST endpoints that are switched on: their parameters, request bodies, responses, errors and auth. `info.version` is the installed app version and `info.x-youtrack-app.id` is `hidden-fields`. Any signed-in user can fetch it.

It never contains field names, data or settings, apart from which REST endpoints are switched on. A `404` means the app isn't installed, or the installed version is older than this endpoint.

```sh
curl -H "Authorization: Bearer $YOUTRACK_TOKEN" \
  "https://youtrack.example.com/api/extensionEndpoints/hidden-fields/meta/openapi.json"
```

### MCP

Add `hidden-fields` to the `customToolPackages` parameter of your MCP server URL:

```text
https://youtrack.example.com/mcp?customToolPackages=hidden-fields
```

| Tool | Arguments | Same as |
|---|---|---|
| `hidden_fields_get_issue` | `issueId`, optional `fields` (a list of field names), optional `full: true` | get_issue |
| `hidden_fields_update_issue` | `issueId`, `field`, `value` or `clear: true`, optional `full: true` | update_issue |

MCP can't pass `null`, so clear a field with `clear: true`. After you install or update the app, reconnect your MCP client. MCP tools aren't tied to projects: they work for every project the caller can see, including projects the app isn't attached to.

## Security

- **Hiding isn't secrecy.** Hiding a field declutters the UI. Anyone who can read an issue can read its exposed fields, and anyone who can update it can change them, unless you set **Allowed group**.
- **Administrators can still write hidden fields.** YouTrack administrators can update a hidden field through YouTrack's own REST API and MCP tools, although they can't read it there. Regular users outside the "Visible to" group can do neither.
- **Guest access.** If the guest account can read a project, its exposed fields can be read without signing in, unless you set Allowed group.
- **Fixed attributes.** Requests run with the technical user's rights, so callers can't choose attributes: the app always asks YouTrack for the same issue attributes and custom field values, never other issues, projects, tags or user emails. Keep the technical user's rights minimal anyway.
- **The token stays inside YouTrack.** It's stored as a secret setting, sent only to your YouTrack, and never returned or logged.
- **Writes are narrow.** update_issue only sets fields on the exposed list, only from JSON requests (`Content-Type: application/json`, so other web pages can't submit writes with a signed-in user's session).
- **Who made a change.** The issue history shows the technical user as the author, so the app logs the real caller for every write: `update_issue: <login> set "<field>" on <issue>` (Administration → Apps → Hidden Fields API → Logs). The value isn't logged.
- **Workflows see the technical user.** Workflow rules, guards and "Updatable by" judge a write by the technical user, not the caller. Expose only metadata fields that no user-based rule protects, never fields like State.
- **Attaching doesn't limit access.** The app-wide URLs and the MCP tools work in every project the technical user can read, attached or not. To limit where the app works, limit the technical user's project access, set Allowed group, or switch interfaces off (see [Choose the interfaces](#choose-the-interfaces)).
- **Switched-off MCP tools stay listed.** YouTrack doesn't let an app hide its tools, so a switched-off tool still appears in MCP clients' tool lists and refuses every call.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Compatibility

Released paths, parameters, operation ids, response fields and error codes are only ever added to, never renamed or removed. Clients should ignore what they don't recognise. A breaking change gets a new path.

Switching an endpoint off isn't a breaking change: it drops out of the description and answers `403` with error `disabled`.

## For client authors

A client can use this app, and any YouTrack app that follows the same convention, without app-specific code:

- Fetch `GET /api/extensionEndpoints/<app-id>/meta/openapi.json` with the user's own token. It's OpenAPI 3.1 JSON and lists only the operations that are currently available.
- `info.version` is the app's version, and `info.x-youtrack-app.id` is its app id.
- Each `operationId` is stable and kebab-case, so it can serve as a command name.
- Paths start with `/api/`; join them to the YouTrack base URL.
- `x-youtrack-scope` on a path says where it works: `global` anywhere; `project` or `issue` only in projects the app is attached to.
- `x-youtrack-entity` marks parameters that name a YouTrack entity: `issue`, `project`, `article` or `user`. App-wide endpoints take them in the query, because YouTrack doesn't support path parameters there.
- Ignore what you don't recognise.

Responses that mean something specific:

- `404` from the description URL: the app isn't installed, or it predates this convention.
- `403` with error `disabled`: the endpoint was switched off since you fetched the description. Fetch it again.
- `404` "HTTP handler not found" from a `project` or `issue` operation: the app isn't attached to that project.

## Troubleshooting

- **An exposed field is missing.** The technical user can't read it. Check that it's in the field's Visible to group. For REST calls the app logs a warning (Administration → Apps → Hidden Fields API → Logs); MCP calls can't detect this case.
- **`403 forbidden`.** Allowed group is set and you aren't a member, you can't update the issue, or the field isn't on the exposed list.
- **`403 disabled`.** That interface is switched off in the app settings (see [Choose the interfaces](#choose-the-interfaces)).
- **`404` "HTTP handler not found by path hidden-fields/api/issue".** The app isn't attached to that issue's project. Attach it, or use the app-wide URL.
- **`502 upstream_error`.** The technical user's call to YouTrack failed. The description says why:
  - `HTTP 404`: the technical user can't read this issue or project. Give it read access there; this is the usual cause when you start using the app in a new project.
  - `HTTP 401`: the token is wrong or expired.
  - `unexpected body` or `no response`: YouTrack can't reach itself at the URL in issue links; set YouTrack base URL.
- **`502 upstream_error` with `HTTP 403` on update_issue.** The technical user can't update the field: give it Update Issue in the project, and check the field's "Updatable by".
- **`404 not_found`, "Field … was not found on this issue".** The field isn't in the issue's project, or the technical user can't see it.
- **`415 unsupported_media_type`.** Send the update with `Content-Type: application/json`.
- **`400 bad_request` from update_issue.** The body isn't `{"field": …, "value": …}`, or YouTrack rejected the value for that field type; the description says which.

## Verify a release

Each release has `hidden-fields-<version>.zip`, `SHA256SUMS`, and a build provenance attestation. Releases are published only once these are attached, and are immutable from then on.

```sh
sha256sum -c SHA256SUMS --ignore-missing   # macOS: shasum -a 256 -c SHA256SUMS --ignore-missing
gh attestation verify hidden-fields-0.0.1.zip --repo vaivars/yt-app-expose-fields-api \
  --signer-workflow vaivars/yt-app-expose-fields-api/.github/workflows/release.yml --source-ref refs/tags/v0.0.1
```

The zip is reproducible: `mise run package` on the release tag produces the same SHA-256.

## Development

You need [mise](https://mise.jdx.dev).

```sh
mise install          # tools
hk install --mise     # git hooks
mise run ci           # everything CI runs
```

| Task | What it does |
|---|---|
| `mise run build` | Bundle the app into `dist/` |
| `mise run test` | Unit tests |
| `mise run typecheck` | TypeScript checks |
| `mise run lint` / `mise run lint-fix` | Linters (see `hk.pkl`) |
| `mise run audit` | Dependency advisories (`osv-scanner.toml`) and registry signatures |
| `mise run package` | Validate and zip into `out/` |
| `mise run yt:up` / `yt:down` / `yt:logs` / `yt:reset` | A local YouTrack from `compose.yaml` (docker compose or podman-compose) |
| `mise run test-contract` | Contract tests against a YouTrack (see [test/contract/README.md](test/contract/README.md)) |
| `mise run deploy-local` | Upload `dist/` to `YOUTRACK_HOST` with `YOUTRACK_TOKEN` |

Conventions are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
