// usage.js - PART THREE: run SETTLE programs, store and recall with a sparse distributed memory, run KANERVA's own
// quickstart, and list the tested examples.
//
// <claudes_code_comments>
// ** Function List **
// resolveSettle(explicit)        - the settle binary: argument, SETTLE_BIN, SETTLE_MCP_HOME, the setup state, then
//                                  `settle` on PATH; returns { bin, how } or { bin: null, tried }
// resolveKanerva(explicit)       - the kanerva crate folder: argument, SETTLE_MCP_HOME, the setup state
// runProgram({ path, source, settle, timeout_ms }) - run one program file or program text; returns stdout,
//                                  stderr, exit code and the command shown
// sdmKeywords(helpText)          - the sdm family's statement words as the installed binary prints them
// sdmProgram(opts, kw)           - a SETTLE program that writes patterns into an sdm and reads one back from a
//                                  noisy read-address
// isSymbol(name)                 - a valid SETTLE symbol word
// kanervaQuickstart({ kanerva, dry_run }) - KANERVA's own example program, built by setup
//
// ** Technical Review **
// - THE SDM TOOL SPEAKS THROUGH SETTLE: SETTLE's sdm statements are KANERVA's address module behind an
//   interpreter (settle-rs depends on the kanerva crate), so a generated .settle program exercises the crate with
//   no extra Rust binary. kanervaQuickstart runs the crate's own example directly as a second route.
// - KEYWORDS ARE READ, NOT ASSUMED: the read statement's address and noise labels (today `read-address:` and
//   `address-noise:`) are parsed from `settle --help`, whose [sdm] lines are generated from the interpreter itself.
//   A rename of those keywords therefore reaches this tool without a code change. If the help cannot be parsed the
//   tool falls back to DEFAULT_SDM_WORDS, Kanerva's terms (word-size, hard-locations, read-address, address-noise,
//   iterated-reads), and says so in its reply. tests/fallback.test.mjs runs that fallback and refuses any word lane
//   KANERVATERMS retired.
// - Program text is written to a fresh temp folder and run there, so relative file names in it resolve inside
//   that folder and nothing lands in the user's working directory.
// </claudes_code_comments>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, showCommand } from './exec.js';
import { readState } from './setup.js';

const exe = process.platform === 'win32' ? '.exe' : '';

export function resolveSettle(explicit) {
  const tried = [];
  const ok = (p) => p && fs.existsSync(p);
  const candidates = [
    [explicit, 'the settle argument'],
    [process.env.SETTLE_BIN, 'SETTLE_BIN'],
    [process.env.SETTLE_MCP_HOME && path.join(process.env.SETTLE_MCP_HOME, 'settle-rs', 'target', 'release', `settle${exe}`), 'SETTLE_MCP_HOME'],
    [readState()?.settle_bin, 'the setup state file'],
  ];
  for (const [p, how] of candidates) {
    if (!p) continue;
    if (ok(p)) return { bin: p, how };
    tried.push(`${how}: ${p} (not found)`);
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, `settle${exe}`);
    if (dir && ok(p)) return { bin: p, how: 'PATH' };
  }
  tried.push('PATH: no settle');
  return { bin: null, tried };
}

export function resolveKanerva(explicit) {
  const cands = [explicit, process.env.SETTLE_MCP_HOME && path.join(process.env.SETTLE_MCP_HOME, 'kanerva'), readState()?.kanerva_dir];
  return cands.find((p) => p && fs.existsSync(path.join(p, 'Cargo.toml'))) || null;
}

export const NOT_SET_UP = 'SETTLE is not built on this machine yet. Run the `setup` tool (dry run first), or pass `settle` with the path of a built binary.';

export async function runProgram({ path: file, source, settle, timeout_ms = 60_000 } = {}) {
  const found = resolveSettle(settle);
  if (!found.bin) return { ok: false, error: NOT_SET_UP, tried: found.tried };
  let prog = file && path.resolve(file);
  let cwd = prog && path.dirname(prog);
  if (!prog) {
    if (!source) return { ok: false, error: 'give either path (a .settle file) or source (the program text)' };
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-mcp-'));
    prog = path.join(cwd, 'program.settle');
    fs.writeFileSync(prog, source);
  } else if (!fs.existsSync(prog)) return { ok: false, error: `no file at ${prog}` };
  const r = await run(found.bin, [prog], { cwd, timeoutMs: timeout_ms });
  return { ok: r.code === 0 && !r.timedOut, exit: r.code, timedOut: r.timedOut, stdout: r.stdout, stderr: r.stderr, ms: r.ms, ran: r.shown, binary: `${found.bin} (from ${found.how})` };
}

// Kanerva's terms (experiments/thermosim/kanerva/KANERVA_TERMS.md); the words a keyword may be spelt with include a hyphen.
export const DEFAULT_SDM_WORDS = { declare: 'sdm', size: 'word-size', locations: 'hard-locations', seed: 'seed', address: 'read-address', noise: 'address-noise', iterations: 'iterated-reads' };

export function sdmKeywords(helpText) {
  const lines = String(helpText || '').split('\n').filter((l) => /^\s*\[sdm\]/.test(l));
  const decl = lines.find((l) => /model:\s*\w+\s+:\w+/.test(l) && !/\.write/.test(l));
  const read = lines.find((l) => /run:\s*\w+\.read\s+[\w-]+:/.test(l));
  if (!decl || !read) return { words: { ...DEFAULT_SDM_WORDS }, fromHelp: false };
  const labels = (s) => [...s.matchAll(/([\w-]+):\s/g)].map((m) => m[1]);
  const dm = decl.match(/model:\s*(\w+)\s+:\w+,\s*(.*)$/);
  const dl = labels(dm[2]);
  const rm = read.match(/run:\s*\w+\.read\s+(.*)$/);
  const rl = labels(rm[1]);
  const pick = (list, want, i) => (list.includes(want) ? want : list[i]);
  return {
    words: {
      declare: dm[1],
      size: pick(dl, 'word-size', 0),
      locations: pick(dl, 'hard-locations', 1),
      seed: pick(dl, 'seed', dl.length - 2),
      address: rl[0],
      noise: rl[1],
      iterations: pick(rl, 'iterated-reads', 2),
    },
    fromHelp: true,
  };
}

export const isSymbol = (n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(n));

export function sdmProgram({ patterns, read, noise = 0.2, size = 256, locations = 2000, seed = 1, reads = 1 }, w) {
  const lines = ['# written by settle-mcp: store patterns in a sparse distributed memory, then read one back', 'model :mind do', `  ${w.declare} :s, ${w.size}: ${size}, ${w.locations}: ${locations}`];
  for (const p of patterns) lines.push(p.text != null ? `  s.write :${p.name}, "${String(p.text).replace(/"/g, "'")}"` : `  s.write :${p.name}`);
  lines.push('end', '', 'run :mind do');
  for (let k = 0; k < reads; k++) lines.push(`  s.read ${w.address}: :${read}, ${w.noise}: ${noise}, seed: ${seed + k}`);
  lines.push('end', '');
  return lines.join('\n');
}

export async function sdmStoreRecall(opts) {
  const found = resolveSettle(opts.settle);
  if (!found.bin) return { ok: false, error: NOT_SET_UP, tried: found.tried };
  const bad = [...opts.patterns.map((p) => p.name), opts.read].filter((n) => !isSymbol(n));
  if (bad.length) return { ok: false, error: `names must be plain words (letters, digits, _): ${bad.join(', ')}` };
  const help = await run(found.bin, ['--help'], { timeoutMs: 15_000 });
  const { words, fromHelp } = sdmKeywords(help.stdout);
  const source = sdmProgram(opts, words);
  const r = await runProgram({ source, settle: found.bin, timeout_ms: opts.timeout_ms || 60_000 });
  return { ...r, program: source, keywords: words, keywordsFrom: fromHelp ? `\`${showCommand(found.bin, ['--help'])}\`` : 'the built-in defaults (the --help text could not be parsed)' };
}

export async function kanervaQuickstart({ kanerva, dry_run = false, timeout_ms = 300_000 } = {}) {
  const dir = resolveKanerva(kanerva);
  if (!dir) return { ok: false, error: 'No kanerva crate found. Run `setup`, or pass kanerva with the folder that holds its Cargo.toml.' };
  const args = ['run', '--release', '--example', 'quickstart'];
  const shown = showCommand('cargo', args, dir);
  if (dry_run) return { ok: true, dry_run: true, would_run: shown };
  const r = await run('cargo', args, { cwd: dir, timeoutMs: timeout_ms });
  return { ok: r.code === 0, exit: r.code, stdout: r.stdout, stderr: r.code === 0 ? '' : r.stderr, ran: shown, ms: r.ms };
}
