// usage.js - PART THREE: run SETTLE programs, store and recall with a sparse distributed memory, run KANERVA's own
// quickstart, and list the tested examples.
//
// <claudes_code_comments>
// ** Function List **
// binaryNameOk(p, want)          - a client-named binary is a regular file called settle or kanerva (with a suffix)
// fileExtOk(p, ext)              - a client-named program file carries the tool's extension
// resolveSettle(explicit)        - the settle binary: argument, SETTLE_BIN, SETTLE_MCP_HOME, the setup state, then
//                                  `settle` on PATH; returns { bin, how } or { bin: null, tried }
// resolveKanerva(explicit)       - the kanerva crate folder: argument (only a crate named kanerva), SETTLE_MCP_HOME,
//                                  the setup state
// runProgram({ path, source, settle, timeout_ms }) - run one program file or program text with `settle --json`;
//                                  returns stdout, stderr, exit code, the command shown and, on an error, its line
//                                  and column as data (error_at); a binary with no --json runs the plain path
// parseSettleJson(stdout)        - settle's --json object, or null when stdout is not one
// caretLines(file, at)           - the CLI's two excerpt lines under an error, from the JSON's line and column
// sdmKeywords(helpText)          - the sdm family's statement words as the installed binary prints them
// settleString(text)            - a stored text as one SETTLE string (no double quote, no line break)
// sdmProgram(opts, kw)           - a SETTLE program that writes patterns into an sdm and reads one back from a
//                                  noisy read-address (word_size, hard_locations, address_noise, seed, reads)
// isSymbol(name)                 - a valid SETTLE symbol word
// resolveKanervaBin(explicit)    - the kanerva command: argument, KANERVA_BIN, SETTLE_MCP_HOME, the setup state, PATH
// runKanerva({ path, source, program, kanerva_bin }) - run a .kanerva program with the kanerva command; a named
//                                  program of the crate's own is compared with its recorded .out
// binVersion(bin)                - a binary's --version line
// kanervaQuickstart({ kanerva, example, dry_run }) - one of KANERVA's own examples (quickstart by default), run with
//                                  cargo in the kanerva folder setup made, compared with its recorded examples/<name>.out
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
//   that folder and nothing lands in the user's working directory. The folder is removed when the run ends.
// - TOOL ARGUMENTS ARE THE CLIENT'S, AND THE CLIENT IS NOT TRUSTED (lane SECMCP): a `settle` or `kanerva_bin`
//   argument must name a file called settle or kanerva (binaryNameOk), a `path` must carry the tool's own extension
//   (.settle, .kanerva), a `program` is a bare name that cannot leave programs/, program text is capped at
//   MAX_SOURCE and a stored text at 2000 characters. The operator's own settings (SETTLE_BIN, KANERVA_BIN,
//   SETTLE_MCP_HOME, the setup state) are not checked this way.
// </claudes_code_comments>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, showCommand } from './exec.js';
import { readState, crateName } from './setup.js';

const exe = process.platform === 'win32' ? '.exe' : '';

// a binary named in a TOOL ARGUMENT comes from the client, so it must look like the program the tool promises: a
// regular file whose name is settle (or kanerva), optionally with a suffix (settle-dev, settle.exe). Without this a
// caller could name any program on the machine (a shell, an interpreter) and the tool would run it with the program
// text as its argument. SETTLE_BIN, KANERVA_BIN, SETTLE_MCP_HOME and the setup state are the operator's and stay trusted.
export function binaryNameOk(p, want) {
  if (typeof p !== 'string' || !p) return false;
  const base = path.basename(p).toLowerCase();
  if (!new RegExp(`^${want}([-_.][a-z0-9._-]*)?$`).test(base)) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
export const badBinary = (p, want) => `refused: ${JSON.stringify(String(p))} is not a ${want} binary. The ${want === 'settle' ? 'settle' : 'kanerva_bin'} argument must name a file called ${want} (for example ${want}, ${want}-dev or ${want}.exe); this server runs nothing else.`;

// a file a tool runs must carry the tool's extension, so the program path cannot point at an arbitrary file on the
// machine and print its lines back through an error excerpt
export const fileExtOk = (p, ext) => typeof p === 'string' && p.toLowerCase().endsWith(ext);

// the most a tool keeps of a program's output, and the longest program text it accepts
export const MAX_SOURCE = 256 * 1024;
// a temp folder made for program text is removed once the run is over
function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export function resolveSettle(explicit) {
  const tried = [];
  const ok = (p) => p && fs.existsSync(p);
  if (explicit && !binaryNameOk(explicit, 'settle')) return { bin: null, refused: badBinary(explicit, 'settle'), tried: [] };
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
  // a folder named in a tool argument must be the kanerva crate itself ([package] name = "kanerva"): cargo runs a
  // crate's build script, so any other folder with a Cargo.toml would be a way to run arbitrary code
  if (explicit && crateName(explicit) !== 'kanerva') return null;
  const cands = [explicit, process.env.SETTLE_MCP_HOME && path.join(process.env.SETTLE_MCP_HOME, 'kanerva'), readState()?.kanerva_dir];
  const hit = cands.find((p) => p && fs.existsSync(path.join(p, 'Cargo.toml')));
  return hit ? path.resolve(hit) : null;
}

// the kanerva command (KANERVA's src/bin/kanerva.rs): argument, KANERVA_BIN, SETTLE_MCP_HOME, the setup state (its
// binary, or target/release under its kanerva folder), then `kanerva` on PATH
export function resolveKanervaBin(explicit) {
  const tried = [];
  if (explicit && !binaryNameOk(explicit, 'kanerva')) return { bin: null, refused: badBinary(explicit, 'kanerva'), tried: [] };
  const st = readState();
  const candidates = [
    [explicit, 'the kanerva_bin argument'],
    [process.env.KANERVA_BIN, 'KANERVA_BIN'],
    [process.env.SETTLE_MCP_HOME && path.join(process.env.SETTLE_MCP_HOME, 'kanerva', 'target', 'release', `kanerva${exe}`), 'SETTLE_MCP_HOME'],
    [st?.kanerva_bin, 'the setup state file'],
    [st?.kanerva_dir && path.join(st.kanerva_dir, 'target', 'release', `kanerva${exe}`), 'the setup state file (its kanerva folder)'],
  ];
  for (const [p, how] of candidates) {
    if (!p) continue;
    if (fs.existsSync(p)) return { bin: p, how };
    tried.push(`${how}: ${p} (not found)`);
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, `kanerva${exe}`);
    if (dir && fs.existsSync(p)) return { bin: p, how: 'PATH' };
  }
  tried.push('PATH: no kanerva');
  return { bin: null, tried };
}

export const NOT_SET_UP = 'SETTLE is not built on this machine yet. Run the `setup` tool (dry run first), or pass `settle` with the path of a built binary.';

export async function runProgram({ path: file, source, settle, timeout_ms = 60_000 } = {}) {
  const found = resolveSettle(settle);
  if (found.refused) return { ok: false, error: found.refused };
  if (!found.bin) return { ok: false, error: NOT_SET_UP, tried: found.tried };
  return runResolved(found, { path: file, source, timeout_ms });
}

// runProgram once the binary is known (sdmStoreRecall resolves it itself, so an operator's SETTLE_BIN is not
// re-checked as if it were a tool argument)
async function runResolved(found, { path: file, source, timeout_ms = 60_000 }) {
  if (file && !fileExtOk(file, '.settle')) return { ok: false, error: 'refused: path must name a .settle file' };
  if (!file && source != null && String(source).length > MAX_SOURCE) return { ok: false, error: `refused: source is longer than ${MAX_SOURCE} characters` };
  let prog = file && path.resolve(file);
  let cwd = prog && path.dirname(prog);
  let tmp = null;
  if (!prog) {
    if (!source) return { ok: false, error: 'give either path (a .settle file) or source (the program text)' };
    cwd = tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-mcp-'));
    prog = path.join(cwd, 'program.settle');
    fs.writeFileSync(prog, source);
  } else if (!fs.existsSync(prog)) return { ok: false, error: `no file at ${prog}` };
  try {
    return await runSettleFile(found, prog, cwd, timeout_ms);
  } finally {
    if (tmp) cleanup(tmp);
  }
}

async function runSettleFile(found, prog, cwd, timeout_ms) {
  const binary = `${found.bin} (from ${found.how})`;
  // THE JSON DOOR FIRST (settle-rs `settle --json`): the lines, or the error's message, line, column and width, as data
  const j = await run(found.bin, ['--json', prog], { cwd, timeoutMs: timeout_ms });
  const parsed = j.timedOut || j.truncated ? null : parseSettleJson(j.stdout);
  if (parsed) {
    const stdout = parsed.ok ? (parsed.lines || []).map((l) => `${l}\n`).join('') : '';
    const at = parsed.ok ? null : parsed.error || null;
    const stderr = at ? `settle: ${at.message}\n${caretLines(prog, at)}` : j.stderr;
    return { ok: parsed.ok && j.code === 0, exit: j.code, timedOut: false, stdout, stderr, ms: j.ms, ran: j.shown, binary, json: true, lines: parsed.ok ? parsed.lines || [] : undefined, error_at: at || undefined };
  }
  if (j.timedOut || j.truncated) return { ok: false, exit: j.code, timedOut: j.timedOut, ...(j.truncated ? { truncated: true } : {}), stdout: j.stdout, stderr: j.stderr, ms: j.ms, ran: j.shown, binary, json: true };
  // THE PLAIN PATH, the fallback: a settle built before --json refuses the option, so the program runs as before
  const r = await run(found.bin, [prog], { cwd, timeoutMs: timeout_ms });
  return { ok: r.code === 0 && !r.timedOut && !r.truncated, exit: r.code, timedOut: r.timedOut, ...(r.truncated ? { truncated: true } : {}), stdout: r.stdout, stderr: r.stderr, ms: r.ms, ran: r.shown, binary, json: false };
}

// settle's one JSON object ({"settle": version, "ok": true, "lines": [...]} or {"ok": false, "error": {...}}), or null
// when stdout is not one (a binary without --json prints its usage error instead)
export function parseSettleJson(stdout) {
  try {
    const o = JSON.parse(String(stdout ?? '').trim());
    return o && typeof o === 'object' && typeof o.settle === 'string' && typeof o.ok === 'boolean' ? o : null;
  } catch {
    return null;
  }
}

// the two excerpt lines the CLI prints under an error, drawn from the JSON's line, column and width and the program
// file itself (the same shape explain_error reads: "   N | <line>" and "     | ^^^ column C"); '' when the error names
// no line or the file cannot be read
export function caretLines(file, at) {
  if (!at || !Number.isInteger(at.line) || !Number.isInteger(at.column)) return '';
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').split('\n')[at.line - 1];
  } catch {
    return '';
  }
  if (text == null) return '';
  const n = String(at.line);
  const pad = ' '.repeat(n.length + 3);
  const width = Math.max(1, Number.isInteger(at.width) ? at.width : 1);
  return `${' '.repeat(Math.max(0, 4 - n.length))}${n} | ${text}\n${pad.slice(0, Math.max(0, 4 - n.length) + n.length)} | ${' '.repeat(at.column - 1)}${'^'.repeat(width)} column ${at.column}\n`;
}

// Kanerva's terms (SETTLE/kanerva/KANERVA_TERMS.md); the words a keyword may be spelt with include a hyphen.
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

// a stored text is one SETTLE string: a double quote becomes a single one and a line break a space, because a SETTLE
// string has no escape and ends at its line (the reply shows the program, so the change is visible)
export const settleString = (t) => String(t).replace(/"/g, "'").replace(/\r?\n|\r/g, ' ');

export function sdmProgram({ patterns, read, address_noise = 0.2, word_size = 256, hard_locations = 2000, seed = 1, reads = 1 }, w) {
  const lines = ['# written by settle-mcp: store patterns in a sparse distributed memory, then read one back', 'model :mind do', `  ${w.declare} :s, ${w.size}: ${word_size}, ${w.locations}: ${hard_locations}`];
  for (const p of patterns) lines.push(p.text != null ? `  s.write :${p.name}, "${settleString(p.text)}"` : `  s.write :${p.name}`);
  lines.push('end', '', 'run :mind do');
  for (let k = 0; k < reads; k++) lines.push(`  s.read ${w.address}: :${read}, ${w.noise}: ${address_noise}, seed: ${seed + k}`);
  lines.push('end', '');
  return lines.join('\n');
}

export async function sdmStoreRecall(opts) {
  const found = resolveSettle(opts.settle);
  if (found.refused) return { ok: false, error: found.refused };
  if (!found.bin) return { ok: false, error: NOT_SET_UP, tried: found.tried };
  const long = opts.patterns.filter((p) => p.text != null && String(p.text).length > 2000).map((p) => p.name);
  if (long.length) return { ok: false, error: `a stored text is at most 2000 characters (these are longer: ${long.join(', ')})` };
  const bad = [...opts.patterns.map((p) => p.name), opts.read].filter((n) => !isSymbol(n));
  if (bad.length) return { ok: false, error: `names must be plain words: letters, digits and _, starting with a letter or _ (these are not: ${bad.join(', ')})` };
  const help = await run(found.bin, ['--help'], { timeoutMs: 15_000 });
  const { words, fromHelp } = sdmKeywords(help.stdout);
  const source = sdmProgram(opts, words);
  const r = await runResolved(found, { source, timeout_ms: opts.timeout_ms || 60_000 });
  return { ...r, program: source, keywords: words, keywordsFrom: fromHelp ? `\`${showCommand(found.bin, ['--help'])}\`` : 'the built-in defaults (the --help text could not be parsed)' };
}

export const NO_KANERVA = 'The kanerva command is not built on this machine yet. Run the `setup` tool (it builds it with `cargo build --release --bins` in the kanerva folder), or pass `kanerva_bin` with the path of a built binary.';

// a .kanerva program (SETTLE's syntax, the sdm family only) run by the kanerva command, from a file, from program text,
// or by the name of one of the crate's own programs (programs/<name>.kanerva in the kanerva folder setup made)
export async function runKanerva({ path: file, source, program, kanerva_bin, kanerva, timeout_ms = 60_000 } = {}) {
  const found = resolveKanervaBin(kanerva_bin);
  if (found.refused) return { ok: false, error: found.refused };
  if (!found.bin) return { ok: false, error: NO_KANERVA, tried: found.tried };
  if (file && !fileExtOk(file, '.kanerva')) return { ok: false, error: 'refused: path must name a .kanerva file' };
  if (!file && !program && source != null && String(source).length > MAX_SOURCE) return { ok: false, error: `refused: source is longer than ${MAX_SOURCE} characters` };
  let prog = file && path.resolve(file);
  let cwd = prog && path.dirname(prog);
  let expected = null;
  let tmp = null;
  if (!prog && program) {
    const dir = resolveKanerva(kanerva);
    const name = String(program).replace(/\.kanerva$/, '');
    // a program is named, never a path: no "..", no slash, so it cannot leave the crate's programs/ folder
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return { ok: false, error: `refused: a program name is letters, digits, _ and - only (not ${JSON.stringify(name)})` };
    if (!dir || !fs.existsSync(path.join(dir, 'programs', `${name}.kanerva`))) {
      const have = dir && fs.existsSync(path.join(dir, 'programs')) ? fs.readdirSync(path.join(dir, 'programs')).filter((f) => f.endsWith('.kanerva')).map((f) => f.slice(0, -8)) : [];
      return { ok: false, error: `No program named "${name}" in ${dir ? path.join(dir, 'programs') : 'a kanerva folder (none found; run setup or pass kanerva)'}.${have.length ? ` These exist: ${have.join(', ')}.` : ''}` };
    }
    cwd = dir;
    prog = path.join(dir, 'programs', `${name}.kanerva`);
    const out = path.join(dir, 'programs', `${name}.out`);
    if (fs.existsSync(out)) expected = fs.readFileSync(out, 'utf8');
  }
  if (!prog) {
    if (!source) return { ok: false, error: 'give one of path (a .kanerva file), source (the program text) or program (the name of one of the crate\'s programs, for example sdm)' };
    cwd = tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-mcp-'));
    prog = path.join(cwd, 'program.kanerva');
    fs.writeFileSync(prog, source);
  } else if (!fs.existsSync(prog)) return { ok: false, error: `no file at ${prog}` };
  let r;
  try {
    r = await run(found.bin, [prog], { cwd, timeoutMs: timeout_ms });
  } finally {
    if (tmp) cleanup(tmp);
  }
  return { ok: r.code === 0 && !r.timedOut && !r.truncated, exit: r.code, timedOut: r.timedOut, ...(r.truncated ? { truncated: true } : {}), stdout: r.stdout, stderr: r.stderr, ms: r.ms, ran: r.shown, binary: `${found.bin} (from ${found.how})`, ...(expected != null ? { matches_recorded_output: r.stdout === expected, recorded: `programs/${path.basename(prog, '.kanerva')}.out` } : {}) };
}

// the version line of a built binary (settle --version, kanerva --version), or null
export async function binVersion(bin) {
  if (!bin) return null;
  const r = await run(bin, ['--version'], { timeoutMs: 15_000 });
  return r.code === 0 ? r.stdout.trim().split('\n')[0] : null;
}

export async function kanervaQuickstart({ kanerva, example = 'quickstart', dry_run = false, timeout_ms = 300_000 } = {}) {
  const dir = resolveKanerva(kanerva);
  if (!dir) return { ok: false, error: 'No kanerva crate found. Run `setup`, or pass kanerva with the folder that holds its Cargo.toml.' };
  const name = String(example).replace(/\.rs$/, '');
  const exdir = path.join(dir, 'examples');
  if (!/^[A-Za-z0-9_]+$/.test(name) || !fs.existsSync(path.join(exdir, `${name}.rs`))) {
    const have = fs.existsSync(exdir) ? fs.readdirSync(exdir).filter((f) => f.endsWith('.rs')).map((f) => f.slice(0, -3)).sort() : [];
    return { ok: false, error: `No example named "${name}" in ${exdir}.${have.length ? ` These exist: ${have.join(', ')}.` : ''}` };
  }
  const args = ['run', '--release', '--example', name];
  const shown = showCommand('cargo', args, dir);
  if (dry_run) return { ok: true, dry_run: true, would_run: shown };
  const r = await run('cargo', args, { cwd: dir, timeoutMs: timeout_ms });
  const rec = path.join(exdir, `${name}.out`);
  const recorded = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : null;
  return { ok: r.code === 0, exit: r.code, stdout: r.stdout, stderr: r.code === 0 ? '' : r.stderr, ran: shown, ms: r.ms, example: name, ...(recorded != null && r.code === 0 ? { matches_recorded_output: r.stdout === recorded } : {}) };
}
