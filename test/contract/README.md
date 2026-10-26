# Contract tests

The contract tests compare the app's output with YouTrack's own REST API on a real instance.

**They change data:** the update tests write to `HF External ID` on the test issue and put it back afterwards. Point them only at a test instance, or at least at a project that exists only for these tests.

Each run:

1. uploads the freshly built `dist/`;
2. attaches the app to the test project;
3. sets the app's settings;
4. calls both the app and YouTrack, and compares the results.

## One-time setup

1. Start YouTrack with `mise run yt:up`.
   - It runs on http://localhost:8080 from `compose.yaml`, using `docker compose`, `podman-compose` or `podman compose`.
   - The container needs about **4 GiB of memory**. With 2 GiB, the operating system kills YouTrack's Java process about every 25 seconds. On podman: `podman machine stop && podman machine set --memory 4096 && podman machine start`.
   - Data is kept in named volumes until you run `mise run yt:reset`.
2. Finish the setup wizard.
   - Open the `wizard_token` URL from `mise run yt:logs`. Set the base URL to `http://localhost:8080`, create the admin account, and accept the licence.
   - Create a permanent token for the admin with the scopes **YouTrack** and **YouTrack Administration**. The second scope is needed to create users and tokens through the Hub API.
3. Create the fixtures:

   | Kind | Value |
   |---|---|
   | Group | `hidden-fields-readers` |
   | Users | `hf-tech` (member of the group) and `hf-user` (not a member), both on the HFT project team; `hf-outsider`, who is not on the team and can't see HFT; `hf-reader`, who can see HFT but lacks Update Issue (for example the Observer role) |
   | Project | name `Hidden Fields Test`, short name `HFT` |
   | Fields in HFT, each **Visible to** `hidden-fields-readers` | `HF External ID` (string), `HF Sync State` (enum: `pending`, `synced`), `HF Internal Note` (string) |
   | Issue | `HFT-1` with HF External ID = `EXT-42`, HF Sync State = `synced`, HF Internal Note = `do not expose` |

   Most of this can be done over REST with the admin token:
   - Project: `POST /api/admin/projects`.
   - Group: `POST /api/groups`.
   - Fields: `POST /api/admin/customFieldSettings/customFields`, then attach each one with `POST /api/admin/projects/{id}/customFields`. For an enum field, give `"bundle": {"id": …, "$type": "EnumBundle"}`.
   - "Visible to": set the undocumented `visibleTo` attribute, `{"$type": …, "visibleTo": {"id": "<group id>", "$type": "NestedGroup"}}`.
   - Issue: `POST /api/issues`.
   - Users: `POST /hub/api/rest/users`. Don't use `POST /api/users`; it creates users without a Hub account, who can't get tokens.
   - Group membership: `POST /hub/api/rest/usergroups/{ringId}/users`.
   - Permanent tokens: `POST /hub/api/rest/users/{ringId}/permanenttokens`, with the YouTrack service as scope.
   - Project team membership has no REST path we know of; add `hf-tech` and `hf-user` in the UI under Project → Team.
4. `hf-tech` needs Update Issue in HFT. Put the tokens in `mise.local.toml`, which is gitignored:

   ```toml
   [env]
   YT_CONTRACT_URL = "http://localhost:8080"
   YT_CONTRACT_SELF_URL = "http://localhost:8080"
   YT_CONTRACT_ADMIN_TOKEN = "perm:…"
   YT_CONTRACT_TECH_TOKEN = "perm:…"
   YT_CONTRACT_USER_TOKEN = "perm:…"
   YT_CONTRACT_OUTSIDER_TOKEN = "perm:…"
   YT_CONTRACT_READER_TOKEN = "perm:…"
   YOUTRACK_HOST = "http://localhost:8080"
   YOUTRACK_TOKEN = "perm:…"
   ```

   `YT_CONTRACT_PROJECT`, `YT_CONTRACT_ISSUE` and `YT_CONTRACT_GROUP` default to `HFT`, `HFT-1` and `hidden-fields-readers`.

## Running

```sh
mise run test-contract
```

## Troubleshooting

- **YouTrack restarts every ~25 seconds or exits.** The container doesn't have enough memory; see step 1.
- **Start fails after a crash with "Database is ciphered with different/unknown cipher parameters".** A process killed mid-write left a truncated text-index file. Move `data/youtrack/textindex` aside inside the data volume, and YouTrack rebuilds it on the next start. The main database is not affected.
