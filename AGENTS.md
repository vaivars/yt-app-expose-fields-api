# Agent guide

Hidden Fields API is a YouTrack app that serves custom fields hidden from the YouTrack UI over REST and MCP. It is written in TypeScript and bundled to CommonJS. README.md explains what it does.

## Layout

- `src/core/`: pure logic with no YouTrack imports (settings, projection, access, the upstream call, the pipeline).
- `src/adapters/`: turns YouTrack objects into pipeline input.
- `src/backend/`: one file per YouTrack module, each exporting exactly one of `httpHandler` or `aiTool`. File names, endpoint paths, tool names and parameters are public API; never rename them. Never delete a backend file either: YouTrack refuses to upgrade an installed app when a script file disappears.
- `scripts/`: build, package, local YouTrack, author check.
- `test/unit/`: unit tests, with fakes for YouTrack's runtime modules in `test/fakes/`.
- `test/contract/`: tests against a real YouTrack.

## Commands

Run `mise run ci` before pushing. Contract tests are described in `test/contract/README.md`.

## Conventions

### Conventional Commits (REQUIRED)

PR titles MUST follow the conventional commit format. Intermediate commit subjects SHOULD use it too.

**Format:** `<type>[optional scope][optional !]: <description>`

**Types:**
- `feat:` new behaviour: endpoints, tools, settings
- `fix:` bug fixes that change how the app behaves (not CI, docs or tooling)
- `refactor:` code changes that keep the behaviour the same
- `docs:` documentation only
- `style:` formatting only
- `perf:` performance improvements
- `test:` tests only
- `chore:` maintenance: releases, dependency and tool updates
- `security:` security fixes and hardening
- `ci:` CI workflows, release automation and repository tooling (`hk.pkl`, mise tasks, scripts)
- `revert:` reverting a previous change

`!` marks a breaking change; below 1.0 it bumps the minor version, as `feat` does.

**Scopes:** `rest`, `mcp`, `settings`, `core`, `release`, `deps`.

**Description:** start lowercase or with an acronym (`REST`, `MCP`), use the imperative mood, keep it short.

### PR titles are release notes

Pull requests are squash-merged, so the PR title becomes the commit subject on `main`. release-please builds `CHANGELOG.md` and the GitHub release notes from those subjects, so write the title for someone running the app.

Releases are prepared by automation in a `chore(main): release X.Y.Z` pull request. Never change the version in `package.json` or `src/manifest.json`, never edit `CHANGELOG.md`, and never push tags by hand.

### Compatibility

`minYouTrackVersion` is `2025.3.0`. Don't use scripting APIs marked `@since 2026.x` in `@jetbrains/youtrack-workflow-types`.

### Tool versions

- Pin every tool in `mise.toml` to an exact version. Upgrade with `mise upgrade --bump`, and commit `mise.toml` and `mise.lock` together.
- `min_version` in `mise.toml` and the `version` input of `jdx/mise-action` in every workflow pin the same mise release. Change them together.
- npm dependencies are exact (`save-exact`), installed with `npm ci`, and run with `ignore-scripts`.
- Every advisory ignored in `osv-scanner.toml` needs a reason and an expiry date.

### GitHub Actions

- Pin every action to a full commit SHA followed by its version tag: `uses: owner/action@<sha> # v1.2.3`.
- Set `permissions: {}` at the workflow level, and grant permissions per job.
- Check out with `persist-credentials: false`.

## GitHub interactions

- `main` is the main branch.
- Develop on branches created from `main`.
- Open pull requests against `main`; they are squash-merged.
