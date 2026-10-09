// json.test.mjs - RUN_PROGRAM SPEAKS SETTLE'S JSON (lane KANERVAPASS, from SETTLEPERFECT's note: "settle-mcp runs
// programs with `settle --json` instead of parsing text"). runProgram calls `settle --json <program>` first, so the
// lines, or an error's message, line, column and width, reach the agent as data; a settle built before --json refuses
// the option and the program runs on the plain path, as before.
//
// Two stand-in binaries (small shell scripts in a temp folder) play the two kinds of settle, so these tests need no
// Rust build. The last test runs a real build when one is found beside the package or in the main checkout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProgram, parseSettleJson, caretLines } from '../src/usage.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-mcp-json-'));

function script(name, body) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

// a settle with --json: an ok program prints two lines, a program holding "lens:" fails at line 2, column 16
const NEW = script(
  'settle-new',
  [
    'if [ "$1" = "--json" ]; then',
    '  if grep -q "lens:" "$2"; then',
    '    echo \'{"settle": "0.1.0", "ok": false, "error": {"message": "line 2: thing does not take `lens:`; did you mean `leans:`?", "line": 2, "column": 16, "width": 5}}\'; exit 2',
    '  fi',
    '  echo \'{"settle": "0.1.0", "ok": true, "lines": ["settled: 100 samples of 1 things at temperature 1", "ask :rain: yes 53.0% of 100 samples"]}\'; exit 0',
    'fi',
    'echo "the plain path ran"; exit 0',
  ].join('\n'),
);
// a settle built before --json: it refuses the option, and runs a program given alone
const OLD = script(
  'settle-old',
  ['case "$1" in', '  -*) echo "settle: unknown option $1 (see settle --help)" >&2; exit 2;;', 'esac', 'echo "settled on the plain path"; exit 0'].join('\n'),
);

const GOOD = 'model :m do\n  thing :rain\nend\nrun :m do\n  settle 100, seed: 1\n  ask :rain\nend\n';
const BAD = 'model :m do\n  thing :rain, lens: :no\nend\n';

test('parseSettleJson takes settle\'s object and nothing else', () => {
  assert.deepEqual(parseSettleJson('{"settle": "0.1.0", "ok": true, "lines": ["a"]}'), { settle: '0.1.0', ok: true, lines: ['a'] });
  assert.equal(parseSettleJson('settled: 100 samples'), null, 'plain text');
  assert.equal(parseSettleJson('{"ok": true}'), null, 'no settle version');
  assert.equal(parseSettleJson('{"settle": "0.1.0", "ok": "yes"}'), null, 'ok is not a boolean');
  assert.equal(parseSettleJson(''), null);
});

test('runProgram calls settle --json and hands back the lines as data and as text', async () => {
  const r = await runProgram({ source: GOOD, settle: NEW });
  assert.equal(r.json, true);
  assert.equal(r.ok, true);
  assert.match(r.ran, /settle-new --json /, 'the command shown carries --json');
  assert.deepEqual(r.lines, ['settled: 100 samples of 1 things at temperature 1', 'ask :rain: yes 53.0% of 100 samples']);
  assert.equal(r.stdout, 'settled: 100 samples of 1 things at temperature 1\nask :rain: yes 53.0% of 100 samples\n');
  assert.equal(r.error_at, undefined);
});

test('an error reaches the agent as its line, column and width, with the CLI\'s caret lines rebuilt from them', async () => {
  const r = await runProgram({ source: BAD, settle: NEW });
  assert.equal(r.ok, false);
  assert.equal(r.exit, 2);
  assert.deepEqual(r.error_at, { message: 'line 2: thing does not take `lens:`; did you mean `leans:`?', line: 2, column: 16, width: 5 });
  // the very text `settle bad.settle` prints on standard error (checked against a real build in the last test)
  assert.equal(r.stderr, 'settle: line 2: thing does not take `lens:`; did you mean `leans:`?\n   2 |   thing :rain, lens: :no\n     |                ^^^^^ column 16\n');
});

test('a settle with no --json runs the program on the plain path, and says so', async () => {
  const r = await runProgram({ source: GOOD, settle: OLD });
  assert.equal(r.json, false);
  assert.equal(r.ok, true);
  assert.equal(r.stdout, 'settled on the plain path\n');
  assert.ok(!/--json/.test(r.ran), 'the plain command carries no --json');
});

test('caretLines draws nothing for an error that names no line', () => {
  const f = path.join(TMP, 'p.settle');
  fs.writeFileSync(f, BAD);
  assert.equal(caretLines(f, { message: 'no program' }), '');
  assert.equal(caretLines(f, { line: 99, column: 1, width: 1 }), '', 'a line past the end');
  assert.equal(caretLines(path.join(TMP, 'missing.settle'), { line: 1, column: 1, width: 1 }), '', 'no file');
});

// a real build: the main checkout's or one beside this package
const REAL = [process.env.SETTLE_TEST_BIN, path.resolve(HERE, '../../settle-rs/target/release/settle')].find((p) => p && fs.existsSync(p));
test('a real settle: --json lines equal the plain lines, and the rebuilt caret equals the CLI\'s own', { skip: !REAL && 'no settle build found' }, async () => {
  const { run } = await import('../src/exec.js');
  const good = path.join(TMP, 'good.settle');
  const bad = path.join(TMP, 'bad.settle');
  fs.writeFileSync(good, GOOD);
  fs.writeFileSync(bad, BAD);
  const plain = await run(REAL, [good], { cwd: TMP, timeoutMs: 30_000 });
  const r = await runProgram({ path: good, settle: REAL });
  if (r.json === false) return; // a build older than --json: the plain path is the tested behaviour above
  assert.equal(r.stdout, plain.stdout);
  const plainBad = await run(REAL, [bad], { cwd: TMP, timeoutMs: 30_000 });
  const rb = await runProgram({ path: bad, settle: REAL });
  assert.equal(rb.stderr, plainBad.stderr);
  assert.equal(rb.exit, plainBad.code);
});
