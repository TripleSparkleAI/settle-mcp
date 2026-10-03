// fallback.test.mjs - THE FALLBACK SPEAKS KANERVA'S TERMS (lane FULLWIDTH, from DHHLEAD's review). When settle --help
// cannot be parsed (no binary, an old binary, a changed help text), sdm_store_recall writes its program with the
// built-in words. Since lane KANERVATERMS the old words (cue:, damage:, size:, locations:, radius:, fire:,
// iterations:, tolerate:) are errors in an sdm statement, so a fallback that still wrote them would hand the user a
// program that fails. These tests run the fallback and refuse any retired word in what it writes or says.
//
// Run: npm test. The last test also runs the fallback program through a real settle build when one is found
// (SETTLE_TEST_BIN, settle-rs/target/release/settle beside this package, or the main checkout's).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdmKeywords, sdmProgram, runProgram } from '../src/usage.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');

// an sdm statement word that KANERVATERMS retired, as a keyword (a word directly before a colon and a space)
export const RETIRED = /(?<![\w-])(cue|damage|locations|radius|fire|iterations|size|tolerate):(?=\s)/g;

const fallback = () => sdmKeywords('the help text of a binary this tool cannot read');
const program = (w) => sdmProgram({ patterns: [{ name: 'cat' }, { name: 'dog', text: 'a dog' }], read: 'cat', reads: 2 }, w);

test('the fallback is taken when the help cannot be parsed, and it says so', () => {
  const f = fallback();
  assert.equal(f.fromHelp, false);
  assert.equal(sdmKeywords('').fromHelp, false);
});

test('the fallback program writes no retired keyword', () => {
  const src = program(fallback().words);
  assert.deepEqual(src.match(RETIRED) ?? [], [], `retired keywords in:\n${src}`);
});

test('the fallback program uses Kanerva\'s terms in both statements', () => {
  const src = program(fallback().words);
  assert.match(src, /sdm :s, word-size: 256, hard-locations: 2000/);
  assert.match(src, /s\.read read-address: :cat, address-noise: 0\.2, seed: 1/);
});

test('the retired-word check can fail (negative control on the words before Kanerva\'s terms)', () => {
  const old = { declare: 'sdm', size: 'si' + 'ze', locations: 'loca' + 'tions', seed: 'seed', address: 'cu' + 'e', noise: 'dam' + 'age', iterations: 'itera' + 'tions' };
  assert.ok((program(old).match(RETIRED) ?? []).length >= 4);
});

test('no settle-mcp source names cue: or damage: as a word the tool writes today', () => {
  for (const f of fs.readdirSync(path.join(PKG, 'src')).filter((n) => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(PKG, 'src', f), 'utf8');
    const hits = text.split('\n').filter((l) => /`(cue|damage):`/.test(l) && !/\b(was|were|before|old|retired|history)\b/i.test(l));
    assert.deepEqual(hits, [], `${f} names a retired keyword as current`);
  }
});

const BIN = [process.env.SETTLE_TEST_BIN, path.resolve(PKG, '..', 'settle-rs', 'target', 'release', 'settle'), path.resolve(PKG, '..', '..', '..', '..', '..', 'experiments', 'thermosim', 'settle-rs', 'target', 'release', 'settle')].find((p) => p && fs.existsSync(p));

test('the fallback program runs on a real settle build', { skip: BIN ? false : 'no settle build found' }, async () => {
  const r = await runProgram({ source: program(fallback().words), settle: BIN, timeout_ms: 60_000 });
  assert.equal(r.exit, 0, `exit ${r.exit}\n${r.stderr}`);
  assert.match(r.stdout, /cat/);
});
