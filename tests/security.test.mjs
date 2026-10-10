// security.test.mjs - lane SECMCP: the client of an MCP server is not trusted. Each test names the hole it closes
// and fails on the code before the fix. Stand-in binaries are small shell scripts, so no Rust build is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProgram, runKanerva, sdmStoreRecall, binaryNameOk, MAX_SOURCE } from '../src/usage.js';
import { run, MAX_OUTPUT } from '../src/exec.js';
import { planSetup, checkSource } from '../src/setup.js';
import { explainError, loadContent } from '../src/content.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-mcp-sec-'));
function script(name, body) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}
// a stand-in that is NOT called settle: the tools must refuse to run it at all
const MARK = path.join(TMP, 'ran.mark');
const NOT_SETTLE = script('helper', `touch ${MARK}; echo ran`);
// a stand-in called settle that prints its program file's directory, so a test can see the temp folder
const SETTLE = script('settle', 'if [ "$1" = "--json" ]; then shift; fi; dirname "$1"; exit 0');
const KANERVA = script('kanerva', 'dirname "$1"; exit 0');

test('binaryNameOk takes settle and kanerva names and refuses everything else', () => {
  assert.equal(binaryNameOk(SETTLE, 'settle'), true);
  assert.equal(binaryNameOk(KANERVA, 'kanerva'), true);
  assert.equal(binaryNameOk(NOT_SETTLE, 'settle'), false);
  assert.equal(binaryNameOk('/bin/sh', 'settle'), false);
  assert.equal(binaryNameOk(TMP, 'settle'), false); // a folder is not a binary
  assert.equal(binaryNameOk(path.join(TMP, 'settle-missing'), 'settle'), false);
});

test('run_program, sdm_store_recall and run_kanerva refuse a binary that is not settle or kanerva', async () => {
  fs.rmSync(MARK, { force: true });
  const a = await runProgram({ source: 'x', settle: NOT_SETTLE });
  assert.equal(a.ok, false);
  assert.match(a.error, /^refused: .* is not a settle binary/);
  const b = await sdmStoreRecall({ patterns: [{ name: 'a' }], read: 'a', settle: NOT_SETTLE });
  assert.match(b.error, /^refused: /);
  const c = await runKanerva({ source: 'x', kanerva_bin: NOT_SETTLE });
  assert.match(c.error, /^refused: .* is not a kanerva binary/);
  const d = await runKanerva({ source: 'x', kanerva_bin: SETTLE }); // the wrong one of the two is refused too
  assert.match(d.error, /^refused: /);
  assert.equal(fs.existsSync(MARK), false, 'the refused binary never ran');
});

test('a binary called settle still runs (vacuity control for the refusal above)', async () => {
  const r = await runProgram({ source: 'model :m do\nend\n', settle: SETTLE });
  assert.equal(r.ok, true);
});

test('a program path must carry the tool extension, so a tool cannot run over any file on the machine', async () => {
  const other = path.join(TMP, 'notes.txt');
  fs.writeFileSync(other, 'private line\n');
  const a = await runProgram({ path: other, settle: SETTLE });
  assert.match(a.error, /path must name a \.settle file/);
  const b = await runKanerva({ path: other, kanerva_bin: KANERVA });
  assert.match(b.error, /path must name a \.kanerva file/);
  const ok = path.join(TMP, 'p.settle');
  fs.writeFileSync(ok, 'x\n');
  assert.equal((await runProgram({ path: ok, settle: SETTLE })).ok, true);
});

test('run_kanerva program is a bare name: no path can leave the crate programs folder', async () => {
  const crate = path.join(TMP, 'crate');
  fs.mkdirSync(path.join(crate, 'programs'), { recursive: true });
  fs.writeFileSync(path.join(crate, 'Cargo.toml'), '[package]\nname = "kanerva"\n');
  fs.writeFileSync(path.join(TMP, 'outside.kanerva'), 'x\n');
  const r = await runKanerva({ program: '../../outside', kanerva: crate, kanerva_bin: KANERVA });
  assert.equal(r.ok, false);
  assert.match(r.error, /^refused: a program name is/);
  fs.writeFileSync(path.join(crate, 'programs', 'sdm.kanerva'), 'x\n');
  assert.equal((await runKanerva({ program: 'sdm', kanerva: crate, kanerva_bin: KANERVA })).ok, true);
});

test('program text is capped, and a stored sdm text is capped', async () => {
  const r = await runProgram({ source: 'x'.repeat(MAX_SOURCE + 1), settle: SETTLE });
  assert.match(r.error, /source is longer than/);
  const s = await sdmStoreRecall({ patterns: [{ name: 'a', text: 'y'.repeat(2001) }], read: 'a', settle: SETTLE });
  assert.match(s.error, /at most 2000 characters/);
});

test('the temp folder made for program text is removed after the run', async () => {
  const r = await runProgram({ source: 'model :m do\nend\n', settle: SETTLE });
  const dir = r.stdout.trim();
  assert.ok(dir.includes('settle-mcp-'), dir);
  assert.equal(fs.existsSync(dir), false, `${dir} was left behind`);
  const k = await runKanerva({ source: 'x', kanerva_bin: KANERVA });
  assert.equal(fs.existsSync(k.stdout.trim()), false);
});

test('a child that prints without end is stopped at the output cap, not kept in memory', async () => {
  const r = await run('/bin/sh', ['-c', 'yes settle'], { timeoutMs: 20_000, maxOutput: 64 * 1024 });
  assert.equal(r.truncated, true);
  assert.equal(r.timedOut, false, 'stopped by the cap, not by the timeout');
  assert.ok(r.stdout.length <= 64 * 1024);
  assert.ok(MAX_OUTPUT >= 1024 * 1024);
});

test('a child that ignores SIGTERM is killed after the grace period', async () => {
  const t = Date.now();
  const r = await run('/bin/sh', ['-c', "trap '' TERM; sleep 30"], { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t < 10_000, 'it did not wait for the sleep');
});

test('setup refuses a source git would read as an option or a remote helper', () => {
  for (const s of ['--upload-pack=x.git', '-c core.x=y.git', 'ext::sh -c x.git', 'gopher://h/r.git', 'https://h/r\n.git']) {
    assert.throws(() => planSetup({ folder: TMP, settle_source: s }), /^Error: refused: /, s);
  }
  assert.throws(() => planSetup({ folder: TMP, settle_source: 'https://h/r.git', kanerva_source: '--x.git' }), /refused/);
  for (const s of ['https://example.com/a/SETTLE.git', 'git@github.com:a/b.git', 'file:///tmp/r.git', TMP]) checkSource(s, 'settle_source');
});

test('explain_error caps its input, so a huge message cannot block the server', () => {
  const content = loadContent();
  const msg = 'settle: line 1: x' + ' takes a whole number from '.repeat(40000) + 'y';
  const t = Date.now();
  explainError(content, msg);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
});

test('kanerva_quickstart runs cargo only in a crate named kanerva', async () => {
  const { kanervaQuickstart } = await import('../src/usage.js');
  const other = path.join(TMP, 'other-crate');
  fs.mkdirSync(path.join(other, 'examples'), { recursive: true });
  fs.writeFileSync(path.join(other, 'Cargo.toml'), '[package]\nname = "something-else"\n');
  fs.writeFileSync(path.join(other, 'examples', 'quickstart.rs'), 'fn main() {}\n');
  const r = await kanervaQuickstart({ kanerva: other, dry_run: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /No kanerva crate found/);
  const good = path.join(TMP, 'kanerva-crate');
  fs.mkdirSync(path.join(good, 'examples'), { recursive: true });
  fs.writeFileSync(path.join(good, 'Cargo.toml'), '[package]\nname = "kanerva"\n');
  fs.writeFileSync(path.join(good, 'examples', 'quickstart.rs'), 'fn main() {}\n');
  assert.equal((await kanervaQuickstart({ kanerva: good, dry_run: true })).ok, true);
});
