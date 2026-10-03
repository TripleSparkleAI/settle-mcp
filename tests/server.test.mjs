// server.test.mjs - settle-mcp tested the way a stranger's MCP client sees it: the official SDK client, over
// stdio, against the real server process. Plus the unit seams (glossary parsing, keyword reading, the plan id).
//
// Run: npm test. Set SETTLE_MCP_E2E_BUILD=1 to also run a full setup (copy + cargo build + verify) in a temp
// folder; without it the usage tests run on the settle-rs build that sits beside this package, when there is one.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { staleFiles, termsTables, boldDefinitions, statementRows, jsxProse, vocabularyRows } from '../tools/build_mcp_docs.mjs';
import { sdmKeywords, sdmProgram, DEFAULT_SDM_WORDS } from '../src/usage.js';
import { planSetup, planId } from '../src/setup.js';
import { refuseSudo, showCommand } from '../src/exec.js';
import { TOOLS, TOOL_NAMES, SDK_VERSION } from '../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const SETTLE_RS = process.env.SETTLE_TEST_SOURCE || path.resolve(PKG, '..', 'settle-rs'); // SETTLE_TEST_SOURCE: settle-rs elsewhere
const BUILT = process.env.SETTLE_TEST_BIN || path.join(SETTLE_RS, 'target', 'release', 'settle'); // SETTLE_TEST_BIN: a build kept outside the tree
const HAVE_BUILD = fs.existsSync(BUILT);
const HAVE_SOURCE = fs.existsSync(path.join(SETTLE_RS, 'Cargo.toml'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-mcp-test-'));

let client;
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join('\n'), data: r.structuredContent, isError: r.isError };
};

before(async () => {
  client = new Client({ name: 'settle-mcp-test', version: '0.0.0' });
  // a stranger's machine: an empty state file and no SETTLE_BIN, so nothing is found until we say where
  const env = { ...process.env, SETTLE_MCP_STATE: path.join(TMP, 'state.json') };
  delete env.SETTLE_BIN;
  delete env.SETTLE_MCP_HOME;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(PKG, 'src', 'bin.js')], env, stderr: 'ignore' }));
});
after(async () => {
  await client?.close();
});

test('the SDK version is pinned exactly and recorded', () => {
  assert.match(SDK_VERSION, /^\d+\.\d+\.\d+$/);
  const lock = JSON.parse(fs.readFileSync(path.join(PKG, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'), 'utf8'));
  assert.equal(lock.version, SDK_VERSION);
});

test('the server lists every tool, in three parts, each with an input schema', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.ok(t.description.length > 30, t.name);
  }
  assert.deepEqual([...new Set(TOOLS.map((t) => t.part))], [1, 2, 3]);
  const setup = tools.find((t) => t.name === 'setup');
  assert.deepEqual(setup.inputSchema.required.sort(), ['folder', 'settle_source']);
  assert.ok(setup.inputSchema.properties.confirm && setup.inputSchema.properties.dry_run);
  const sdm = tools.find((t) => t.name === 'sdm_store_recall');
  assert.equal(sdm.inputSchema.properties.patterns.type, 'array');
});

test('help with no topic names the three parts and every tool', async () => {
  const { text } = await call('help');
  for (const p of ['PART ONE', 'PART TWO', 'PART THREE']) assert.ok(text.includes(p), p);
  for (const t of TOOLS) assert.ok(text.includes(`\`${t.name}\``), t.name);
});

test('help returns the glossary, built from the docs, with sources', async () => {
  const { data } = await call('help', { topic: 'glossary' });
  assert.ok(data.count > 100, `glossary has ${data.count} entries`);
  const terms = new Set(data.entries.map((e) => e.term));
  for (const t of ['thing', 'settle', 'anneal', 'sdm', 'symbol', 'store', 'run_program']) assert.ok(terms.has(t), t);
  assert.ok(data.entries.every((e) => e.source && e.definition));
  // positive control: an entry's definition is really in the doc it cites
  const content = JSON.parse(fs.readFileSync(path.join(PKG, 'content', 'docs.json'), 'utf8'));
  const anneal = data.entries.find((e) => e.term === 'anneal' && e.kind === 'SETTLE statement');
  const doc = content.docs.find((d) => d.path === anneal.source);
  assert.ok(doc.text.includes(anneal.definition));
});

test('help looks up one word and refuses an unknown one plainly', async () => {
  const hit = await call('help', { topic: 'lean' });
  assert.ok(hit.data.entries.some((e) => e.term === 'lean'));
  const miss = await call('help', { topic: 'zzqqnotaname' });
  assert.equal(miss.data.entries.length, 0);
  assert.match(miss.text, /Nothing in the glossary/);
});

test('every generated doc matches a fresh build from the site (no drift)', async () => {
  assert.deepEqual(await staleFiles(), [], 'run `npm run build-docs` in settle-mcp');
});

const SITE_DOCS = path.resolve(PKG, '..', '..', '..', 'sites', 'settle-site', 'src', 'data', 'mcpDocs.js');
test("the tool descriptions are the site's words, and the server registers exactly the site's tools", { skip: !fs.existsSync(SITE_DOCS) && 'a standalone copy: no site beside the package' }, () => {
  const site = fs.readFileSync(SITE_DOCS, 'utf8');
  for (const t of TOOLS) assert.ok(site.includes(t.description), t.name);
  assert.deepEqual(TOOLS.map((t) => t.name), TOOL_NAMES);
});

test('the page reader keeps prose and English from t(), and drops code', () => {
  const md = jsxProse(`<Section label={t('x.l', 'WAT DIS')} title="A thing"><p className="sci-plain">A <b>lean</b> is {t('x.p', 'one number')}{' '}per thing, &ldquo;h&rdquo;. {value}</p><p>{() => 1}</p></Section>`);
  assert.equal(md, '## A thing (WAT DIS)\n\nA **lean** is one number per thing, “h”.');
  // rich(): the English reaches the docs, a mapped tag read as its text, values and JSX arguments skipped (lane I18NALL)
  const rich = jsxProse(`<p>{rich('k.p', 'See <lab>the lab</lab> and a <b>read</b> at a noisy address.', { n: f(2) }, { lab: <a href={go('x')} /> })}</p>`);
  assert.equal(rich, 'See the lab and a **read** at a noisy address.');
  assert.deepEqual(vocabularyRows('| English | 日本語 | note |\n|---|---|---|\n| lean | 傾き | how much a thing leans toward yes |', 'g.md').map((r) => [r.term, r.definition]), [['lean', 'how much a thing leans toward yes']]);
});

test('the glossary parsers read tables and bold definitions, and keep an old name as an alias', () => {
  const rows = statementRows('| [`hold`](#hold) | run | Fix a thing at yes or no. |', 'core', 'x.md');
  assert.deepEqual(rows.map((r) => [r.term, r.block]), [['hold', 'run']]);
  const bold = boldDefinitions('A **valley** is an arrangement from which no single flip goes downhill.', 'v.md', 'SETTLE word');
  assert.equal(bold[0].term, 'valley');
  const terms = termsTables('| old | new | meaning |\n|---|---|---|\n| `cue` | `read-address` | the address a read starts from |\n', 'k.md');
  assert.deepEqual(terms[0], { term: 'read-address', kind: 'KANERVA term', definition: 'the address a read starts from', source: 'k.md', aliases: ['cue'] });
});

test('read_doc and the resources serve the SETTLE and KANERVA docs', async () => {
  const d = await call('read_doc', { name: '03-syntax' });
  assert.match(d.text, /^# Syntax/);
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri);
  for (const u of ['settle-mcp://help', 'settle-mcp://glossary', 'settle-mcp://usage', 'settle-mcp://setup', 'kanerva://readme', 'settle://docs/03-syntax.md']) assert.ok(uris.includes(u), u);
  const k = await client.readResource({ uri: 'kanerva://readme' });
  assert.match(k.contents[0].text, /^# KANERVA/);
  const ex = await client.readResource({ uri: 'settle://examples/core-ask' });
  assert.match(ex.contents[0].text, /tested output/);
});

// WHO YOU ARE (lane WHOYOUARE, 2026-10-02): the three audience guides are the first documents, AGENTS.md is a resource
// and the instructions every client reads at initialize send it there first.
test('AGENTS.md and the WHO YOU ARE guides: the first docs, a resource, and the initialize instructions name them', async () => {
  const list = await call('read_doc');
  assert.deepEqual(list.data.docs.slice(0, 4).map((d) => d.uri), ['site://who-you-are', 'site://who-you-are/for-programmers', 'site://who-you-are/for-visual-artists', 'site://who-you-are/for-sound-artists']);
  const prog = await call('read_doc', { name: 'who-you-are/for-programmers' });
  assert.match(prog.text, /^# For programmers/);
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri);
  for (const u of ['settle-mcp://agents', 'site://who-you-are', 'site://who-you-are/for-visual-artists', 'site://who-you-are/for-sound-artists']) assert.ok(uris.includes(u), u);
  const agents = await client.readResource({ uri: 'settle-mcp://agents' });
  assert.match(agents.contents[0].text, /^# AGENTS\.md: settle-mcp/m);
  assert.equal(agents.contents[0].text, fs.readFileSync(path.join(PKG, 'AGENTS.md'), 'utf8'));
  for (const h of ['## Who you are helping', '## Where each reader starts', '## The tools, in three parts']) assert.ok(agents.contents[0].text.includes(h), h);
  const instructions = client.getInstructions();
  assert.match(instructions, /settle-mcp:\/\/agents/);
  for (const f of ['for-programmers', 'for-visual-artists', 'for-sound-artists']) assert.ok(instructions.includes(`site://who-you-are/${f}`), f);
  const help = await call('help');
  assert.match(help.text, /settle-mcp:\/\/agents/);
});

test('the three prompts exist and carry the docs they cite', async () => {
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), ['explain-settling', 'sdm-store-recall', 'write-settle-program']);
  const p = await client.getPrompt({ name: 'write-settle-program', arguments: { task: 'decide whether to carry an umbrella' } });
  assert.match(p.messages[0].content.text, /umbrella/);
  assert.match(p.messages[0].content.text, /# Syntax/);
});

test('explain_error finds the documented cause and a tested program that makes it', async () => {
  const r = await call('explain_error', { message: 'settle: line 6: a string is missing its closing quote' });
  assert.equal(r.data.line, 6);
  assert.ok(r.data.matches.some((m) => /closing quote/.test(m.message)), JSON.stringify(r.data.matches));
});

test('setup dry run lists every command and runs none of them', { skip: !HAVE_SOURCE && 'no settle-rs beside the package (set SETTLE_TEST_SOURCE)' }, async () => {
  const folder = path.join(TMP, 'dry');
  const r = await call('setup', { folder, settle_source: SETTLE_RS });
  assert.equal(r.data.dry_run, true);
  assert.match(r.data.plan_id, /^[0-9a-f]{16}$/);
  const cmds = r.data.steps.map((s) => s.command);
  assert.ok(cmds.some((c) => c.includes('cargo build --release')), cmds.join('\n'));
  assert.ok(cmds.some((c) => c.startsWith('copy ') && c.includes('kanerva')), 'kanerva is copied from beside settle-rs');
  assert.ok(!cmds.some((c) => /\bsudo\b/.test(c)));
  assert.equal(fs.existsSync(folder), false, 'a dry run makes nothing');
  assert.equal(fs.existsSync(path.join(TMP, 'state.json')), false, 'a dry run writes no state');
});

test('setup refuses to run without the matching confirm, and a changed argument changes the id', async () => {
  const folder = path.join(TMP, 'noconfirm');
  const r = await call('setup', { folder, settle_source: SETTLE_RS, dry_run: false, confirm: 'not-the-id' });
  assert.equal(r.data.error, 'confirm-mismatch');
  assert.equal(fs.existsSync(folder), false);
  const a = planSetup({ folder, settle_source: SETTLE_RS });
  const b = planSetup({ folder, settle_source: SETTLE_RS, build_quickstart: false });
  assert.notEqual(a.id, b.id);
  assert.equal(a.id, planId(a.steps));
});

test('setup has no default source and invents no URL', async () => {
  const r = await call('setup', { folder: path.join(TMP, 'x'), settle_source: '' });
  assert.match(r.text, /settle_source/);
  const git = planSetup({ folder: path.join(TMP, 'g'), settle_source: 'https://example.com/someone/SETTLE.git' });
  assert.ok(git.steps.some((s) => s.shown === `git clone --depth 1 https://example.com/someone/SETTLE.git ${path.join(git.folder, 'sources', 'settle')}`));
  assert.ok(git.steps.some((s) => s.shown === 'git --version'));
});

test('the command runner refuses privilege and quotes what it shows', () => {
  assert.throws(() => refuseSudo('sudo', ['cargo', 'build']), /refused/);
  assert.throws(() => refuseSudo('/usr/bin/su', []), /refused/);
  assert.doesNotThrow(() => refuseSudo('cargo', ['build']));
  assert.equal(showCommand('settle', ['my prog.settle'], '/tmp/a b'), "(cd '/tmp/a b' && settle 'my prog.settle')");
});

test('the sdm keywords are read from the help text, so a rename reaches the program', () => {
  const today = sdmKeywords('  [sdm] model: sdm :s, word-size: 256, hard-locations: 2000, activation-radius: 112, seed: 1, fade: 1\n  [sdm] run: s.read read-address: :cat, address-noise: 0.3, iterated-reads: 10, via: :addresses, seed: 1   (via: :pulls too)');
  assert.equal(today.fromHelp, true);
  assert.deepEqual([today.words.size, today.words.locations, today.words.address, today.words.noise, today.words.iterations], ['word-size', 'hard-locations', 'read-address', 'address-noise', 'iterated-reads']);
  assert.match(sdmProgram({ patterns: [{ name: 'cat' }], read: 'cat' }, today.words), /sdm :s, word-size: 256, hard-locations: 2000\n[\s\S]*s\.read read-address: :cat, address-noise: 0\.2/);
  // a help text in the words before Kanerva's terms still parses, by position
  const older = sdmKeywords('  [sdm] model: sdm :s, si' + 'ze: 256, loca' + 'tions: 2000, seed: 1\n  [sdm] run: s.read cu' + 'e: :cat, dam' + 'age: 0.3, itera' + 'tions: 10, seed: 1');
  assert.deepEqual([older.words.address, older.words.noise], ['cu' + 'e', 'dam' + 'age']);
  assert.equal(sdmKeywords('nothing here').fromHelp, false);
  assert.deepEqual(sdmKeywords('').words, DEFAULT_SDM_WORDS);
  assert.equal(DEFAULT_SDM_WORDS.address, 'read-address');
});

test('usage tools say plainly when SETTLE is not built', async () => {
  const r = await call('run_program', { source: 'model :m do\nend\n' });
  assert.match(r.text, /not built on this machine yet/);
});

test('run_program on a known program matches its stored output', { skip: !HAVE_BUILD && 'no settle-rs build beside the package' }, async () => {
  const content = JSON.parse(fs.readFileSync(path.join(PKG, 'content', 'docs.json'), 'utf8'));
  const ex = content.examples.find((e) => e.name === 'core-ask');
  const r = await call('run_program', { path: path.join(SETTLE_RS, 'docs', 'examples', 'core-ask.settle'), settle: BUILT });
  assert.equal(r.data.exit, 0);
  assert.equal(r.data.stdout, ex.out);
  const src = await call('run_program', { source: ex.source, settle: BUILT });
  assert.equal(src.data.stdout, ex.out, 'program text gives the same output as the file');
});

test('sdm_store_recall writes, reads back and shows its program', { skip: !HAVE_BUILD && 'no settle-rs build beside the package' }, async () => {
  const r = await call('sdm_store_recall', { patterns: [{ name: 'cat' }, { name: 'dog' }, { name: 'note', text: 'meet at nine' }], read: 'note', noise: 0.15, settle: BUILT });
  assert.equal(r.data.exit, 0, r.text);
  assert.match(r.data.stdout, /-> :note/);
  assert.match(r.data.stdout, /meet at nine/);
  assert.match(r.data.keywordsFrom, /--help/);
});

test('a full setup from a local folder builds and verifies', { skip: process.env.SETTLE_MCP_E2E_BUILD !== '1' && 'set SETTLE_MCP_E2E_BUILD=1', timeout: 1_200_000 }, async () => {
  const folder = path.join(TMP, 'real');
  const dry = await call('setup', { folder, settle_source: SETTLE_RS });
  let r = await call('setup', { folder, settle_source: SETTLE_RS, dry_run: false, confirm: dry.data.plan_id, wait_seconds: 600 });
  while (r.data.state === 'running') {
    await new Promise((res) => setTimeout(res, 5000));
    r = await call('setup_status', { job: r.data.job });
  }
  assert.equal(r.data.state, 'done', r.text);
  assert.ok(r.data.steps.filter((s) => /verify/.test(s.label)).every((s) => s.status === 'ok'));
  const run = await call('run_program', { path: path.join(folder, 'settle-rs', 'docs', 'examples', 'core-ask.settle') });
  assert.equal(run.data.exit, 0, run.text);
  const q = await call('kanerva_quickstart', {});
  assert.equal(q.data.exit, 0, q.text);
  assert.match(q.data.stdout, /memory: 50000 locations/);
});
