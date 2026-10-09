# settle-mcp release checklist

This file lists what was checked for the 0.1.0 release and what the navigator must still decide. It is not
shipped in the npm package (the `files` list in package.json leaves it out).

## Checked on 2026-10-06 (lane MCPREADY): ready from GitHub

The whole journey a stranger takes, run from the export `--push` would publish, is recorded step by step in
`SETTLE/runs/mcpready/JOURNEY.md` (the logs beside it, `journey.sh` to run it again).

| check | result |
|---|---|
| the export | `export_settle_repos.sh --only settle-mcp`: 39 files, 3828 kB; secret scan 0 hits; 4 dev-only hits, all reviewed |
| install from a git URL | `npm install <git url>` into a fresh project, then `settle-mcp --version`: `settle-mcp 0.1.0 (@modelcontextprotocol/sdk 1.32.0)` |
| THE ONE COMMAND | `npx -y --allow-git=root <git url> --version` from an empty folder: the same line, 1.63 s; on npm 12.0.2 the same command without `--allow-git=root` is refused (`EALLOWGIT`) |
| the package's tests in a clone | 37 tests, 32 pass, 0 fail, 5 skip; the full setup end to end passed |
| a real MCP client | the SDK client listed 12 tools, 177 resources, 1 template and 3 prompts and called every tool once, setup included; 0 unexpected errors |
| agents on this machine | Hermes (`mcp add`, 12 tools, `mcp test` connected), Codex (`codex mcp add`, listed enabled), Claude Code (`claude mcp add --scope project`, written; a project server waits for approval) |
| the real GitHub address | `npx -y --allow-git=root github:triplesparkle/settle-mcp --version` worked against the private repository with this machine's git credentials, and printed SDK 1.31.0: the repository still holds the 2026-10-03 push |
| package.json | `repository`, `homepage`, `bugs` and `author` point at github.com/triplesparkle/settle-mcp; `private` stays true (it blocks `npm publish`, and npx from GitHub still works) |
| licence | MIT, `LICENSE` in the repository |

## Making it public (in the launch walk)

The navigator ruled the repositories public at launch, under the MIT licence (2026-10-09). The by-hand steps that
were here are now part of `SETTLE/launch.sh`:

1. Push the current export, which carries `LICENSE`: `bash SETTLE/tools/export_settle_repos.sh --only settle-mcp --push`.
   The export creates nothing new (the repository exists) and pushes to a repository that reads PRIVATE or PUBLIC.
2. `bash SETTLE/launch.sh --public` (step 7 of the walk, just before the site's deploying push) makes settle-mcp
   public with the other seven SETTLE repositories, refuses one whose GitHub copy has no MIT licence yet, and reads
   each one back as PUBLIC.
3. Check it from outside this checkout: `npx -y --allow-git=root github:triplesparkle/settle-mcp --version` must print
   the SDK version in package.json.
4. Optional, later: publish to npm (remove `"private": true`, `npm publish`); the one command becomes
   `npx -y settle-mcp` and needs no git flag. And list it in an MCP registry.

The site already says public: `SETTLE/settle-site/src/repo.js` reads `public` for every repository, and the words in
`SETTLE/settle-site/src/data/mcpDocs.js` that said private were changed with it (lane PUBLICLAUNCH). SETTLE and
KANERVA go public in the same step, so setup can fetch them for anyone.


## Checked on 2026-10-05

| check | result |
|---|---|
| `npm test` (31 tests) | 31 pass with `SETTLE_TEST_BIN` set to a settle build and `SETTLE_MCP_E2E_BUILD=1`; without them 28 pass and 3 skip |
| the full setup, end to end | dry run, confirm by plan id, copy, `cargo build --release`, both verify steps ok, then `run_program` and `kanerva_quickstart` on the result |
| a real MCP client over stdio | the SDK's own client listed 11 tools, 172 resources, 1 resource template and 3 prompts, read `settle-mcp://agents`, and called every tool once |
| `npm pack --dry-run` | 31 files; ships `AGENTS.md`, `CHANGELOG.md`, `LICENSE` and every file the server reads; ships no test, no export script and no machine path (a test holds this) |
| dependencies | `@modelcontextprotocol/sdk` 1.32.0 and `zod` 4.6.5, both pinned exactly, both the npm latest on 2026-10-05; `npm audit` reports 0 vulnerabilities |
| licence | MIT, `LICENSE` in the folder, copyright "TripleSparkle" |
| privilege | the command runner refuses sudo, su, doas, pkexec and runas; no step runs an installer |
| URLs | setup has no default source; README.md, AGENTS.md, docs/SETUP.md, docs/USAGE.md and the three guides name only the triplesparkle repositories (settle-mcp, SETTLE, KANERVA, settle-see, settle-hear), which exist and are private; the server's own messages name only rustup.rs, git-scm.com/downloads and nodejs.org |
| the docs | README.md, AGENTS.md and docs/ are generated from the SETTLE site and match a fresh build (`npm run check-docs`) |
| the standalone repository | `SETTLE/tools/export_settle_repos.sh --only settle-mcp` into a scratch folder: the secret and dev-only scans pass, and `npm install && npm test` pass in the export |

## What the navigator must decide

1. **Publish to npm or not.** `"private": true` is set in package.json so that nothing is published by accident.
   Remove it to publish. The name `settle-mcp` was free on npm on 2026-10-05 (`npm view settle-mcp` returned 404).
2. **Make the repositories public or not.** DECIDED: public at launch (the navigator, 2026-10-09). The README and
   docs say so; `SETTLE/launch.sh --public` does it.
3. **The repository fields in package.json.** Done 2026-10-06: `repository`, `homepage`, `bugs` and `author` point at
   github.com/triplesparkle/settle-mcp.
4. **The copyright holder.** `LICENSE` says "Copyright (c) 2026 TripleSparkle". Confirm the legal name of the holder.
5. **The Node version.** `engines` says Node 18 or newer. Every run on 2026-10-05 used Node 22.22.3. Node 18 is past
   its end of life and was not tested. Decide whether to test it or to require Node 20.
6. **The package size.** The tarball is 1.1 MB packed and 3.6 MB unpacked. Most of it is `content/docs.json`
   (2.1 MB, the search index) and `docs/site/strings.md` (1.0 MB, every English string of the site). Decide whether
   the strings page belongs in the package.
7. **A default source for setup.** Setup asks for `settle_source` every time and never assumes a URL. If SETTLE becomes
   public, decide whether its repository becomes the default.
8. **The date of 0.1.0** in CHANGELOG.md, which says "unreleased".
9. **An MCP registry listing.** The server is not listed in any MCP server registry. Decide whether to list it once it
   is public.

## Notes for other folders

- The SETTLE docs this server serves (from `SETTLE/settle-rs/docs`) say the interpreter "lives in the dwarfstar
  repository at `SETTLE/settle-rs/`". That text belongs to the settle-rs docs, not to this package.
