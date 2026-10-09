// server.test.mjs - settle-mcp tested the way a stranger's MCP client sees it: the official SDK client, over
// stdio, against the real server process. Plus the unit seams (glossary parsing, keyword reading, the plan id).
//
// Run: npm test. Set SETTLE_MCP_E2E_BUILD=1 to also run a full setup (copy + cargo build + verify) in a temp
// folder; without it the usage tests run on the settle-rs build that sits beside this package, when there is one.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { staleFiles, termsTables, boldDefinitions, statementRows, jsxProse, vocabularyRows } from '../tools/build_mcp_docs.mjs';
import { sdmKeywords, sdmProgram, DEFAULT_SDM_WORDS } from '../src/usage.js';
import { parseErrorText, documentedErrors, loadContent } from '../src/content.js';
import { planSetup, planId } from '../src/setup.js';
import { refuseSudo, showCommand } from '../src/exec.js';
import { TOOLS, TOOL_NAMES, SDK_VERSION } from '../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const SETTLE_RS = process.env.SETTLE_TEST_SOURCE || path.resolve(PKG, '..', 'settle-rs'); // SETTLE_TEST_SOURCE: settle-rs elsewhere
const BUILT = process.env.SETTLE_TEST_BIN || path.join(SETTLE_RS, 'target', 'release', 'settle'); // SETTLE_TEST_BIN: a build kept outside the tree
const HAVE_BUILD = fs.existsSync(BUILT);
const KANERVA_DIR = path.resolve(SETTLE_RS, '..', 'kanerva');
const KBUILT = process.env.KANERVA_TEST_BIN || path.join(KANERVA_DIR, 'target', 'release', 'kanerva'); // KANERVA_TEST_BIN: a kanerva command kept outside the tree
const HAVE_KBUILD = fs.existsSync(KBUILT) && fs.existsSync(path.join(KANERVA_DIR, 'programs'));
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

const SITE_DOCS = path.resolve(PKG, '..', '..', 'SETTLE', 'settle-site', 'src', 'data', 'mcpDocs.js');
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

test('explain_error reads an error as the command prints it: the caret line, the column, the suggestion', async () => {
  const printed = 'settle: line 2: thing does not take `leens:`; did you mean `leans:`?\n   2 |   thing :rain, leens: :no\n     |                ^^^^^^ column 16';
  const p = parseErrorText(printed);
  assert.deepEqual([p.program, p.line, p.column, p.marked, p.suggestion], ['settle', 2, 16, 'leens:', 'leans:']);
  assert.equal(p.message, 'thing does not take `leens:`; did you mean `leans:`?', 'the caret lines are not part of the message');
  const r = await call('explain_error', { message: printed });
  assert.ok(r.data.matches.some((m) => m.message.includes('does not take')), JSON.stringify(r.data.matches));
  assert.match(r.text, /The caret marks `leens:`/);
  assert.match(r.text, /The interpreter suggests `leans:` in place of `leens:`/);
  assert.ok(r.data.matches.every((m) => !/\s"|"\s*,/.test(m.cause.replace(/"[^"]*"/g, ''))), 'a double-backtick span becomes one quoted phrase');
  assert.match(r.data.matches.find((m) => m.message.includes('does not take')).cause, /The hint is "did you mean <key>:\?"/);
  // negative control: the first line alone still matches, and has no caret to report
  const bare = parseErrorText(printed.split('\n')[0]);
  assert.equal(bare.column, null);
  assert.equal(bare.marked, null);
  // the double-backtick rows of the error tables are read (the keyword error is one)
  assert.ok(documentedErrors(loadContent()).some((d) => d.message.startsWith('<statement> does not take')));
  const k = parseErrorText('kanerva: line 3: sdm word-size must be between 16 and 4096');
  assert.deepEqual([k.program, k.line], ['kanerva', 3]);
});

test('run_kanerva and the kanerva command: plain refusal before setup, a program by name, an error marked', async () => {
  const none = await call('run_kanerva', { program: 'sdm' });
  assert.equal(none.isError, true);
  assert.match(none.text, /kanerva command is not built/);
  const { tools } = await client.listTools();
  const rk = tools.find((t) => t.name === 'run_kanerva').inputSchema.properties;
  assert.deepEqual(Object.keys(rk).sort(), ['kanerva', 'kanerva_bin', 'path', 'program', 'source', 'timeout_ms']);
  assert.ok(tools.find((t) => t.name === 'kanerva_quickstart').inputSchema.properties.example, 'kanerva_quickstart takes example');
});

test('run_kanerva runs a crate program and checks it against its recorded output', { skip: !HAVE_KBUILD && 'no kanerva command built beside the package' }, async () => {
  const r = await call('run_kanerva', { program: 'sdm', kanerva_bin: KBUILT, kanerva: KANERVA_DIR });
  assert.equal(r.data.exit, 0, r.text);
  assert.equal(r.data.matches_recorded_output, true, r.text);
  assert.equal(r.data.stdout, fs.readFileSync(path.join(KANERVA_DIR, 'programs', 'sdm.out'), 'utf8'));
  const bad = await call('run_kanerva', { source: 'model :m do\n  sdm :s, word-size: 8\nend\n', kanerva_bin: KBUILT });
  assert.equal(bad.isError, true);
  assert.match(bad.data.stderr, /^kanerva: line 2:/);
  const unknown = await call('run_kanerva', { program: 'no-such-program', kanerva_bin: KBUILT, kanerva: KANERVA_DIR });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /These exist: .*sdm/);
});

test('setup builds the kanerva command and verifies it on one of its programs', { skip: !HAVE_SOURCE && 'no settle-rs beside the package' }, () => {
  const plan = planSetup({ folder: path.join(TMP, 'k'), settle_source: SETTLE_RS });
  assert.ok(plan.steps.some((s) => s.shown.includes('cargo build --release --bins --example quickstart')), plan.steps.map((s) => s.shown).join('\n'));
  assert.ok(plan.steps.some((s) => s.kind === 'verify-kanerva'));
  assert.match(plan.kanerva_bin, /kanerva[\\/]target[\\/]release[\\/]kanerva(\.exe)?$/);
  const noq = planSetup({ folder: path.join(TMP, 'k'), settle_source: SETTLE_RS, build_quickstart: false });
  assert.ok(noq.steps.some((s) => s.shown.endsWith('cargo build --release --bins)')), 'without the quickstart, the command is still built');
});

test('the README a stranger reads: the one command first, every agent in order, every tool with an example', () => {
  const readme = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8');
  const body = readme.replace(/^<!--[\s\S]*?-->\s*/, '');
  const firstFence = body.match(/```sh\n([^\n]+)\n```/);
  assert.equal(firstFence[1], 'claude mcp add settle -- npx -y --allow-git=root github:TripleSparkleAI/settle-mcp', 'the first command in the README is the one command');
  const order = ['Hermes', 'Claude Code', 'Claude Desktop', 'Codex', 'Cursor', 'Windsurf', 'Cline', 'Gemini CLI', 'Zed', 'VS Code (GitHub Copilot)', 'Continue'];
  const at = order.map((n) => body.indexOf(`### ${n}\n`));
  assert.ok(at.every((i) => i > 0), `every agent has a section: ${order.filter((n, i) => at[i] < 0).join(', ')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the agents come in the navigator\'s order, Hermes first');
  for (const t of TOOLS) assert.ok(new RegExp(`- \`${t.name}\`: [\\s\\S]*?Example: \``).test(body), `${t.name} has an example`);
  for (const t of TOOLS) assert.doesNotThrow(() => JSON.parse(t.example), `${t.name}'s example is JSON`);
  for (const w of ['Node 18', 'Rust', 'MIT', 'sudo', 'issues', 'dry run']) assert.ok(body.includes(w), `the README says ${w}`);
  assert.ok(fs.existsSync(path.join(PKG, 'docs', 'INSTALL.md')));
});

test('the README opens with the repository banner, and the READMEs served to agents carry none', () => {
  const readme = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8');
  const m = /^<!-- settle-banner -->\n```text\n([\s\S]*?)\n```\n\n<!-- GENERATED /.exec(readme);
  assert.ok(m, 'the banner block is the first thing in the README, then the generated marker');
  const lines = m[1].split('\n');
  assert.equal(lines.length, 7, 'seven banner lines: five title rows, one blank line, then the description');
  // the rows darken from the top: row 1 ░, row 2 ▒, row 3 ▓, rows 4 and 5 █, each its own shade and spaces only
  ['░', '▒', '▓', '█', '█'].forEach((s, i) => assert.match(lines[i], new RegExp(`^[${s} ]*${s}$`), `title row ${i + 1} is ${s} and spaces, no trailing space`));
  assert.equal(lines[5], '', 'one blank line between the title and the ✦ line');
  assert.match(lines[6], /^✦ an MCP server/, 'the description line');
  // the documents the server hands an agent go without the banner (the build strips it)
  const docs = JSON.parse(fs.readFileSync(path.join(PKG, 'content', 'docs.json'), 'utf8')).docs;
  const readmes = docs.filter((d) => /:\/\/readme$/.test(d.uri));
  assert.ok(readmes.length >= 2, 'the SETTLE and KANERVA READMEs are served');
  for (const d of readmes) assert.ok(!d.text.includes('<!-- settle-banner -->'), `${d.uri} carries no banner`);
});

test('package.json points at the repository, the issues and the licence, and stays unpublishable by accident', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.equal(pkg.repository.url, 'git+https://github.com/TripleSparkleAI/settle-mcp.git');
  assert.equal(pkg.bugs.url, 'https://github.com/TripleSparkleAI/settle-mcp/issues');
  assert.equal(pkg.homepage, 'https://github.com/TripleSparkleAI/settle-mcp#readme');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.private, true, 'private: true blocks npm publish; npx github: still runs it');
  assert.deepEqual(Object.keys(pkg.bin), ['settle-mcp'], 'one bin, so npx picks it');
  assert.match(fs.readFileSync(path.join(PKG, pkg.bin['settle-mcp']), 'utf8'), /^#!\/usr\/bin\/env node\n/);
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

test('usage tools say plainly when SETTLE is not built, and mark the reply as an error', async () => {
  const r = await call('run_program', { source: 'model :m do\nend\n' });
  assert.match(r.text, /not built on this machine yet/);
  assert.equal(r.isError, true);
});

test('a refusal or a missing name is marked isError; a good answer is not', async () => {
  assert.equal((await call('get_example', { name: 'no-such-example' })).isError, true);
  assert.equal((await call('read_doc', { name: 'no-such-doc-zq' })).isError, true);
  assert.equal((await call('setup', { folder: path.join(TMP, 'm'), settle_source: SETTLE_RS, dry_run: false, confirm: 'wrong' })).isError, true);
  assert.notEqual((await call('get_example', { name: 'core-ask' })).isError, true, 'negative control: a found example is no error');
});

test('the tool schemas speak Kanerva\'s terms and keep a setup call under a 60 s client timeout', async () => {
  const { tools } = await client.listTools();
  const sdm = tools.find((t) => t.name === 'sdm_store_recall').inputSchema.properties;
  assert.deepEqual(['address_noise', 'word_size', 'hard_locations'].filter((k) => !sdm[k]), []);
  assert.deepEqual(['noise', 'size', 'locations'].filter((k) => sdm[k]), [], 'the old argument names are gone');
  const wait = tools.find((t) => t.name === 'setup').inputSchema.properties.wait_seconds;
  assert.ok(wait.maximum < 60, `wait_seconds maximum ${wait.maximum}`);
  for (const t of tools) for (const [k, v] of Object.entries(t.inputSchema.properties || {})) assert.ok(v.description || k === 'patterns', `${t.name}.${k} has no description`);
});

test('the package ships every file the server reads, and no machine path', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: PKG, encoding: 'utf8' });
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  for (const need of ['src/bin.js', 'src/server.js', 'tools/build_mcp_docs.mjs', 'content/docs.json', 'AGENTS.md', 'docs/USAGE.md', 'docs/SETUP.md', 'docs/INSTALL.md', 'docs/GLOSSARY.md', 'README.md', 'CHANGELOG.md', 'LICENSE']) assert.ok(files.includes(need), `${need} is not in the package`);
  assert.deepEqual(files.filter((f) => /^(tests|node_modules)\/|RELEASE_CHECKLIST|export_|record-showcase/.test(f)), [], 'nothing for the repository only');
  for (const f of files) {
    const text = fs.readFileSync(path.join(PKG, f), 'utf8');
    assert.ok(!/\/Users\/|\/home\/[a-z]|\/private\/var|\/var\/folders/.test(text), `${f} carries a machine path`);
  }
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
  const r = await call('sdm_store_recall', { patterns: [{ name: 'cat' }, { name: 'dog' }, { name: 'note', text: 'meet at nine' }], read: 'note', address_noise: 0.15, settle: BUILT });
  assert.equal(r.data.exit, 0, r.text);
  assert.match(r.data.stdout, /-> :note/);
  assert.match(r.data.stdout, /meet at nine/);
  assert.match(r.data.keywordsFrom, /--help/);
  assert.match(r.data.program, /address-noise: 0\.15/, 'address_noise reached the program');
  const multi = await call('sdm_store_recall', { patterns: [{ name: 'note', text: 'two "quoted"\nlines' }], read: 'note', settle: BUILT });
  assert.equal(multi.data.exit, 0, multi.text);
  assert.match(multi.data.program, /s\.write :note, "two 'quoted' lines"/);
});

test('a full setup from a local folder builds and verifies', { skip: process.env.SETTLE_MCP_E2E_BUILD !== '1' && 'set SETTLE_MCP_E2E_BUILD=1', timeout: 1_200_000 }, async () => {
  const folder = path.join(TMP, 'real');
  const dry = await call('setup', { folder, settle_source: SETTLE_RS });
  // the default wait (50 s) stays under the SDK client's 60 s request timeout; the build goes on and is polled
  let r = await call('setup', { folder, settle_source: SETTLE_RS, dry_run: false, confirm: dry.data.plan_id });
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
  // the crate's own recorded output is the reference, so a KANERVA rewording cannot leave this test behind
  assert.equal(q.data.matches_recorded_output, true, q.text);
  assert.match(q.data.stdout, /^memory: 50000 hard-locations/);
  const k = await call('run_kanerva', { program: 'sdm' });
  assert.equal(k.data.matches_recorded_output, true, k.text);
});
