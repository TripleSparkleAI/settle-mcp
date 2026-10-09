#!/usr/bin/env node
// record-showcase.mjs - drive the real server with the official SDK client, from scratch, and record every call
// and its reply. The site's #/mcp page shows this record, so every output on that page is a real one.
//
// <claudes_code_comments>
// ** Function List **
// scrub(s)   - the machine's own paths written as $TMPDIR, <repo> and ~ so the record carries no home directory
// step(...)  - one tool call: the arguments, the reply text, the time it took
// main       - a fresh state file and a temp folder; help, the glossary, check_system, setup (dry run, then the real
//              run with its plan id), run_program, sdm_store_recall, explain_error (a caret error), run_kanerva,
//              kanerva_quickstart; writes
//              the record to ../runs/settlemcp/showcase.json and the site's src/data/mcpShowcase.js
//
// ** Technical Review **
// - The source for setup is this checkout's own settle-rs (a local folder), because nothing is published yet.
// - Path prefixes are replaced by name only: the temp folder by $TMPDIR, the repository by <repo>, the home folder by
//   ~. Nothing else in a reply is changed. Long replies keep their first lines and say how many were cut.
// </claudes_code_comments>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO = path.resolve(PKG, '..', '..');
const SETTLE_RS = path.resolve(PKG, '..', 'settle-rs');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'settle-mcp-show-')));
const OUT_JSON = path.resolve(PKG, '..', 'runs', 'settlemcp', 'showcase.json');
const OUT_SITE = path.resolve(REPO, 'SETTLE', 'settle-site', 'src', 'data', 'mcpShowcase.js');

// the temp folder has two spellings on macOS (/var/... and its real path /private/var/...); both become $TMPDIR
const tmpRoots = [fs.realpathSync(os.tmpdir()), os.tmpdir().replace(/\/$/, '')];
export function scrub(s) {
  let out = String(s).split(TMP).join('$TMPDIR/settle-mcp-show');
  for (const t of tmpRoots) out = out.split(t).join('$TMPDIR');
  return out.split(REPO).join('<repo>').split(os.homedir()).join('~');
}
const clip = (s, n = 40) => {
  const lines = s.split('\n');
  return lines.length <= n ? s : `${lines.slice(0, n).join('\n')}\n… (${lines.length - n} more lines)`;
};

const client = new Client({ name: 'settle-mcp-showcase', version: '0.0.0' });
const env = { ...process.env, SETTLE_MCP_STATE: path.join(TMP, 'state.json') };
delete env.SETTLE_BIN;
delete env.SETTLE_MCP_HOME;
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(PKG, 'src', 'bin.js')], env, stderr: 'ignore' }));

const steps = [];
async function step(part, title, tool, args, lines = 40) {
  const t0 = Date.now();
  const r = await client.callTool({ name: tool, arguments: args });
  const text = r.content.map((c) => c.text).join('\n');
  const rec = { part, title, tool, args: JSON.parse(scrub(JSON.stringify(args))), reply: clip(scrub(text), lines), ms: Date.now() - t0 };
  steps.push(rec);
  console.error(`${tool}: ${rec.ms} ms`);
  return r;
}

const { tools } = await client.listTools();
const folder = path.join(TMP, 'settle');
await step(1, 'Ask for help with nothing installed', 'help', { topic: 'lean' });
await step(1, 'Look up an SDM word', 'help', { topic: 'read-address' }, 20);
// the error as the settle command prints it today: the first line, then the program line and the caret under it
await step(1, 'Explain an error message', 'explain_error', { message: 'settle: line 2: thing does not take `leens:`; did you mean `leans:`?\n   2 |   thing :rain, leens: :no\n     |                ^^^^^^ column 16' }, 24);
await step(2, 'Check the machine (version commands only)', 'check_system', {});
const dry = await step(2, 'Plan the setup: a dry run, nothing runs', 'setup', { folder, settle_source: SETTLE_RS }, 60);
// wait_seconds is at most 55 (a client usually stops waiting after 60 s); a longer build is polled and its last status
// recorded as its own step, so the record never claims a setup finished inside one call when it did not
const ran = await step(2, 'Run exactly that plan, by its id', 'setup', { folder, settle_source: SETTLE_RS, dry_run: false, confirm: dry.structuredContent.plan_id, wait_seconds: 55 }, 60);
if (ran.structuredContent?.state === 'running') {
  let st;
  do {
    await new Promise((res) => setTimeout(res, 5000));
    st = await client.callTool({ name: 'setup_status', arguments: { job: ran.structuredContent.job } });
  } while (st.structuredContent?.state === 'running');
  await step(2, 'Ask how the setup went', 'setup_status', { job: ran.structuredContent.job }, 60);
}
await step(3, 'Run a tested example', 'run_program', { path: path.join(folder, 'settle-rs', 'docs', 'examples', 'core-ask.settle') });
await step(3, 'Store three memories, read one from a noisy read-address', 'sdm_store_recall', { patterns: [{ name: 'cat' }, { name: 'dog' }, { name: 'note', text: 'meet at nine' }], read: 'note', address_noise: 0.15 });
await step(3, 'Run a .kanerva program by name', 'run_kanerva', { program: 'sdm' });
await step(3, "Run KANERVA's own quickstart", 'kanerva_quickstart', {});
await client.close();

const record = {
  recorded: new Date().toISOString(),
  sdk: JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).dependencies['@modelcontextprotocol/sdk'],
  machine: `${process.platform} ${process.arch}, node ${process.version}`,
  tools: tools.map((t) => ({ name: t.name, description: t.description })),
  steps,
};
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(record, null, 1) + '\n');
fs.writeFileSync(
  OUT_SITE,
  `// GENERATED by SETTLE/settle-mcp/tools/record-showcase.mjs - do not edit by hand.\n` +
    `// Real calls to the settle-mcp server over stdio with the official SDK client, recorded ${record.recorded}.\n` +
    `// Paths are written as $TMPDIR, <repo> and ~; nothing else in a reply is changed.\n` +
    `export const MCP_SHOWCASE = ${JSON.stringify(record, null, 1)};\n`,
);
console.error(`wrote ${path.relative(REPO, OUT_JSON)} and ${path.relative(REPO, OUT_SITE)}`);
