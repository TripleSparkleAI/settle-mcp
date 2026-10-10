# Changelog

All notable changes to settle-mcp. The format follows Keep a Changelog; versions follow semantic versioning.

## 0.1.0 (unreleased)

The first release. Nothing has been published to npm, and the repository is private.

### The server

- An MCP server over stdio, built on `@modelcontextprotocol/sdk` 1.32.0 and zod 4.6.5, both pinned exactly.
- PART ONE, docs and help, needs nothing installed: `help`, `read_doc`, `list_examples`, `get_example`,
  `explain_error`; every SETTLE, KANERVA and site document as a resource; every tested example as
  `settle://examples/{name}`; three prompts (`explain-settling`, `write-settle-program`, `sdm-store-recall`).
- PART TWO, setup: `check_system` runs only version commands; `setup` is a dry run until it is called again with
  `dry_run` false and `confirm` set to the plan id; `setup_status` reports a build that goes on in the background.
  No step uses a privileged command, no installer runs, and no source URL is assumed.
- PART THREE, usage: `run_program`, `sdm_store_recall` and `kanerva_quickstart`.
- Every doc the server serves (README.md, AGENTS.md, docs/) is generated from the SETTLE website by
  `tools/build_mcp_docs.mjs`; the tool descriptions are the website's words.

### Security (2026-10-11)

The client of an MCP server is not trusted: a tool argument may come from a page or a document the model read.
`tests/security.test.mjs` holds one test per change below, and each fails on the code before it.

- `settle` and `kanerva_bin` must name a file called `settle` or `kanerva` (a suffix such as `settle-dev` or
  `.exe` is fine). Before, any program on the machine could be named, and it ran with the program text as its
  argument. `SETTLE_BIN`, `KANERVA_BIN`, `SETTLE_MCP_HOME` and the setup state are the operator's and are not checked.
- `run_program`'s `path` must end in `.settle` and `run_kanerva`'s in `.kanerva`, so a tool cannot run over any
  file and print its lines back in an error excerpt. `run_kanerva`'s `program` is a bare name and cannot leave
  `programs/`. A `kanerva` folder passed to `kanerva_quickstart` or `run_kanerva` must be the crate named `kanerva`.
- `setup` refuses a source that starts with `-`, uses a git remote helper (`transport::`), holds a control
  character, or uses a URL scheme other than http, https, ssh or file.
- Program text is capped at 256 KB, a stored sdm text at 2,000 characters, and `explain_error`'s message at 20,000
  characters (its table match grew with the square of the input: 432 KB blocked the server for 4.5 s).
- A child's output is kept up to 1 MB per stream; past it the child is stopped and the reply says so. A timeout
  sends SIGTERM to the child's whole process group and SIGKILL 2 s later. The temp folder made for program text is
  removed after the run.

### The organisation (2026-10-09)

- The repository moved from the GitHub user account `triplesparkle` to the organisation `TripleSparkleAI`. GitHub
  redirects the old address. The one command, `package.json` (`repository`, `homepage`, `bugs`), the README, the
  install guides and every generated doc name `github:TripleSparkleAI/settle-mcp` and
  `github.com/TripleSparkleAI/...`.

### Ready from GitHub (2026-10-06)

- THE ONE COMMAND: `claude mcp add settle -- npx -y --allow-git=root github:TripleSparkleAI/settle-mcp` runs the server
  straight from its GitHub repository, with nothing cloned or built by hand. `--allow-git=root` is needed because npm 12
  refuses a git package by default (`allow-git` defaults to `none`); npm 10 takes the flag and changes nothing. Measured
  on npm 10.9.8 and 12.0.2 (SETTLE/runs/mcpready/JOURNEY.md).
- The README is rebuilt for a stranger reading it cold: the one command first, what it needs, an install guide for each
  agent in this order (Hermes, Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Cline, Gemini CLI, Zed, VS Code,
  Continue, any other client), every tool with an example, the resources, the prompts, the setup flow, what it never
  does, the licence and where to report problems. The same guides are `docs/INSTALL.md`.
- `run_kanerva`: run a `.kanerva` program with the `kanerva` command (KANERVA alone, no SETTLE), from a file, from
  text, or one of the crate's own programs by name, checked against its recorded output. The programs are resources,
  `kanerva://programs/{name}`.
- `kanerva_quickstart` takes `example` and runs any of the crate's examples (calibrated_refusal, rails, sizing ...),
  checked against its recorded `examples/<name>.out`.
- `explain_error` reads an error as the command prints it, caret line and all: the column, the marked word and the
  "did you mean" suggestion. It now reads the error tables' double-backtick rows too (438 documented errors read
  before, 472 now), so the keyword error that carries a suggestion is found.
- `check_system` asks a built `settle` and `kanerva` for their `--version`.
- `setup` builds the `kanerva` command (`cargo build --release --bins`) and verifies it on one of its own
  `programs/*.kanerva`; the state file records its path, and `KANERVA_BIN` points at one directly.
- package.json carries `repository`, `homepage`, `bugs` and `author` for github.com/TripleSparkleAI/settle-mcp.
- The docs build also writes the SETTLE site's files for agents: `/llms.txt`, `/llms-full.txt`, a Markdown mirror of
  every document under `/llms/`, and `/robots.txt`.
- The end-to-end setup test compares the quickstart with KANERVA's own recorded output (it asserted an older wording).

### Release checks (2026-10-05)

- `sdm_store_recall` takes Kanerva's terms as its argument names: `address_noise`, `word_size` and
  `hard_locations` (they were `noise`, `size` and `locations`). A stored text with a line break or a double quote
  is written as one SETTLE string.
- A refusal, a missing name and a failed setup now come back with `isError` true.
- `setup`'s `wait_seconds` is at most 55, so a call returns before a client's usual 60 s timeout; the build goes on
  and `setup_status` reports it.
- Every tool argument has a description.
- The package ships `AGENTS.md`, which the `settle-mcp://agents` resource reads, and no longer ships the
  repository-only tools (the showcase recorder and the export script).
- `private` is set in package.json, so the package cannot be published by accident. Publishing is a decision listed
  in RELEASE_CHECKLIST.md.
