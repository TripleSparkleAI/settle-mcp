// setup.js - PART TWO: check the machine, then fetch, build and verify SETTLE and KANERVA in a folder the user picks.
//
// <claudes_code_comments>
// ** Function List **
// statePath() / readState() / writeState(s) - where a finished setup is remembered (SETTLE_MCP_STATE, or
//                                  ~/.settle-mcp/state.json)
// sourceKind(src)                - 'git' for a URL (https, ssh, git@, file://, *.git), 'path' for a local folder
// crateName(dir)                 - the [package] name in dir/Cargo.toml, or null
// findCrate(root, name, depth)   - the folder under root whose Cargo.toml names the package (root, then children)
// kanervaDepPath(settleDir)      - the path settle-rs's Cargo.toml gives for its kanerva dependency
// checkSystem()                  - runs only version queries: rustc, cargo, git, node; reports each with a fix
// planSetup(opts)                - the exact steps setup would take, every command written out, and a plan id
// planId(steps)                  - sha256 of the steps' shown commands: the confirm token
// runSetup(plan, { onStep })     - performs a plan step by step, stopping at the first failure
// startSetupJob(plan) / jobStatus(id) - the same, as a background job that can be polled
//
// ** Technical Review **
// - SHOWN BEFORE RUN: setup is dry-run by default and returns the plan with its id. Running needs dry_run false
//   AND confirm equal to that id, so the commands a person approved are the commands that run. A changed
//   argument changes the id and the old confirm no longer matches.
// - NO INVENTED URL: nothing is published yet, so a source is always the user's own: a local folder (the
//   dwarfstar checkout's SETTLE/settle-rs, or a clone) or a git URL they were given. A private
//   repository asks for access at the clone step, and the step reports git's own words.
// - THE LAYOUT: <folder>/settle-rs and <folder>/kanerva side by side, because settle-rs depends on
//   kanerva = { path = "../kanerva" }. Local sources are copied without target/ and .git; a git source is
//   cloned into <folder>/sources/<name> and the crates are copied out of it. Copies run in this process
//   (fs.cpSync); their plan line says so instead of pretending to be a shell command.
// - VERIFY: after cargo build --release, the built settle runs two tested examples from its own docs (a core
//   program and an sdm program, which reaches KANERVA) and compares stdout with the stored .out byte for byte; then
//   the kanerva command (cargo build --release --bins) runs one of KANERVA's own programs/*.kanerva the same way.
//   A KANERVA older than its file face has neither, and that step says so and passes.
// - No step uses sudo; exec.js refuses one if it ever appears. Missing rust or git is reported with the
//   official install page; this server never runs an installer.
// </claudes_code_comments>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run, showCommand, tail } from './exec.js';

export const VERIFY_EXAMPLES = { core: ['core-ask', 'core-seed', 'core-leans-and-pulls'], sdm: ['sdm-read', 'sdm-text', 'sdm-fade'] };
// the kanerva command's own programs (kanerva/programs/<name>.kanerva with its .out), tried in order
export const VERIFY_KANERVA = ['sdm', 'theory', 'softsdm', 'sdmscale'];
export const INSTALL_PAGES = { rust: 'https://rustup.rs', git: 'https://git-scm.com/downloads', node: 'https://nodejs.org' };

export function statePath() {
  return process.env.SETTLE_MCP_STATE || path.join(os.homedir(), '.settle-mcp', 'state.json');
}
export function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
}
export function writeState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2) + '\n');
}

export function sourceKind(src) {
  const s = String(src);
  return /^(https?:\/\/|ssh:\/\/|git@|file:\/\/)/.test(s) || /\.git\/?$/.test(s) ? 'git' : 'path';
}

export function crateName(dir) {
  try {
    const toml = fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8');
    const pkg = toml.split(/^\[/m).find((s) => s.startsWith('package]'));
    return (pkg?.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || null;
  } catch {
    return null;
  }
}

export function findCrate(root, name, depth = 3) {
  if (!root || !fs.existsSync(root)) return null;
  if (crateName(root) === name) return root;
  if (depth <= 0) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const skip = new Set(['target', 'node_modules', '.git', 'runs']);
  for (const e of entries) {
    if (!e.isDirectory() || skip.has(e.name) || e.name.startsWith('.')) continue;
    const hit = findCrate(path.join(root, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

export function kanervaDepPath(settleDir) {
  try {
    const toml = fs.readFileSync(path.join(settleDir, 'Cargo.toml'), 'utf8');
    return (toml.match(/^kanerva\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/m) || [])[1] || null;
  } catch {
    return null;
  }
}

async function version(cmd, args) {
  const r = await run(cmd, args, { timeoutMs: 15_000 });
  return r.code === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : null;
}

export async function checkSystem() {
  const checks = [
    { tool: 'rustc', cmd: 'rustc', args: ['--version'], needed: 'to build SETTLE and KANERVA', page: INSTALL_PAGES.rust },
    { tool: 'cargo', cmd: 'cargo', args: ['--version'], needed: 'to build SETTLE and KANERVA', page: INSTALL_PAGES.rust },
    { tool: 'git', cmd: 'git', args: ['--version'], needed: 'only to fetch from a git URL', page: INSTALL_PAGES.git },
  ];
  const out = [];
  for (const c of checks) {
    const v = await version(c.cmd, c.args);
    out.push({ tool: c.tool, ran: showCommand(c.cmd, c.args), found: Boolean(v), version: v, needed: c.needed, fix: v ? null : `Install it from ${c.page}. This server does not run installers.` });
  }
  out.push({ tool: 'node', ran: '(this process)', found: true, version: process.version, needed: 'to run this MCP server', fix: null });
  return { platform: `${process.platform} ${process.arch}`, checks: out, ready: out.filter((c) => c.tool !== 'git').every((c) => c.found) };
}

const copyStep = (label, from, to) => ({ kind: 'copy', label, from, to, shown: `copy ${from} -> ${to} (in this process, skipping target/ and .git/)` });
const cmdStep = (label, cmd, args, cwd, extra = {}) => ({ kind: 'cmd', label, cmd, args, cwd, shown: showCommand(cmd, args, cwd), ...extra });

export function planId(steps) {
  return crypto.createHash('sha256').update(steps.map((s) => s.shown).join('\n')).digest('hex').slice(0, 16);
}

export function planSetup({ folder, settle_source, kanerva_source, build_quickstart = true } = {}) {
  if (!folder) throw new Error('setup needs folder: where to put settle-rs and kanerva');
  if (!settle_source) throw new Error('setup needs settle_source: a local folder or a git URL holding settle-rs (nothing is published yet, so there is no default)');
  const dest = path.resolve(String(folder).replace(/^~(?=$|\/)/, os.homedir()));
  const settleOut = path.join(dest, 'settle-rs');
  const kanervaOut = path.join(dest, 'kanerva');
  const notes = [];
  const steps = [];
  const gitSources = [settle_source, kanerva_source].filter((s) => s && sourceKind(s) === 'git');
  steps.push(cmdStep('check rustc', 'rustc', ['--version'], undefined, { check: true }));
  steps.push(cmdStep('check cargo', 'cargo', ['--version'], undefined, { check: true }));
  if (gitSources.length) steps.push(cmdStep('check git', 'git', ['--version'], undefined, { check: true }));
  steps.push({ kind: 'mkdir', label: 'make the folder', to: dest, shown: `mkdir -p ${dest}` });

  const fetch = (src, name, crate, out) => {
    if (sourceKind(src) === 'git') {
      const clone = path.join(dest, 'sources', name);
      steps.push(cmdStep(`clone ${name}`, 'git', ['clone', '--depth', '1', src, clone]));
      steps.push({ kind: 'locate', label: `find the ${crate} crate in the clone`, crate, from: clone, to: out, shown: `find the folder whose Cargo.toml names "${crate}" under ${clone}, then copy it to ${out}` });
      return;
    }
    const abs = path.resolve(String(src).replace(/^~(?=$|\/)/, os.homedir()));
    const found = findCrate(abs, crate);
    if (!found) notes.push(`No Cargo.toml naming "${crate}" was found under ${abs} (searched 3 levels). Check the path.`);
    steps.push(copyStep(`copy ${crate}`, found || abs, out));
    return found;
  };

  const settleFound = fetch(settle_source, 'settle', 'settle', settleOut);
  if (kanerva_source) fetch(kanerva_source, 'kanerva', 'kanerva', kanervaOut);
  else if (sourceKind(settle_source) === 'git') {
    steps.push({ kind: 'locate', label: 'find the kanerva crate in the same clone', crate: 'kanerva', from: path.join(dest, 'sources', 'settle'), to: kanervaOut, shown: `find the folder whose Cargo.toml names "kanerva" under ${path.join(dest, 'sources', 'settle')}, then copy it to ${kanervaOut}` });
  } else if (settleFound) {
    const rel = kanervaDepPath(settleFound) || '../kanerva';
    const sibling = path.resolve(settleFound, rel);
    if (crateName(sibling) !== 'kanerva') notes.push(`settle-rs names kanerva at ${rel}, and ${sibling} does not hold it. Pass kanerva_source.`);
    steps.push(copyStep('copy kanerva (the dependency settle-rs names)', sibling, kanervaOut));
  }

  steps.push(cmdStep('build SETTLE (and KANERVA with it)', 'cargo', ['build', '--release'], settleOut, { timeoutMs: 900_000 }));
  // the kanerva command (src/bin/kanerva.rs, which runs .kanerva programs) and, unless asked not to, the quickstart
  // example; --bins builds every binary the crate has, so a KANERVA from before the command still builds
  steps.push(cmdStep(build_quickstart ? 'build the kanerva command and the KANERVA quickstart example' : 'build the kanerva command', 'cargo', ['build', '--release', '--bins', ...(build_quickstart ? ['--example', 'quickstart'] : [])], kanervaOut, { timeoutMs: 900_000 }));
  const exe = process.platform === 'win32' ? '.exe' : '';
  const bin = path.join(settleOut, 'target', 'release', `settle${exe}`);
  const kanervaBin = path.join(kanervaOut, 'target', 'release', `kanerva${exe}`);
  for (const [family, names] of Object.entries(VERIFY_EXAMPLES)) {
    steps.push({ kind: 'verify', label: `verify: run a tested ${family} example and compare its output`, family, names, bin, cwd: settleOut, shown: `${bin} docs/examples/<${names.join('|')}>.settle, compared with the stored .out (the first of these that exists)` });
  }
  steps.push({ kind: 'verify-kanerva', label: 'verify: run a .kanerva program with the kanerva command and compare its output', bin: kanervaBin, cwd: kanervaOut, names: VERIFY_KANERVA, shown: `${kanervaBin} programs/<${VERIFY_KANERVA.join('|')}>.kanerva, compared with the stored .out (the first of these that exists)` });
  steps.push({ kind: 'state', label: 'remember this setup', to: statePath(), shown: `write ${statePath()} with the folder and the binary paths` });
  return { folder: dest, settle_bin: bin, kanerva_dir: kanervaOut, kanerva_bin: kanervaBin, steps, notes, id: planId(steps) };
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) throw new Error(`${from} does not exist`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true, filter: (src) => !/[\\/](target|\.git|node_modules)$/.test(src) });
}

async function doStep(s) {
  if (s.kind === 'mkdir') {
    fs.mkdirSync(s.to, { recursive: true });
    return { ok: true, detail: `made ${s.to}` };
  }
  if (s.kind === 'copy') {
    copyTree(s.from, s.to);
    return { ok: true, detail: `copied to ${s.to}` };
  }
  if (s.kind === 'locate') {
    const found = findCrate(s.from, s.crate);
    if (!found) return { ok: false, detail: `no crate named "${s.crate}" under ${s.from}` };
    copyTree(found, s.to);
    return { ok: true, detail: `found ${found}, copied to ${s.to}` };
  }
  if (s.kind === 'cmd') {
    const r = await run(s.cmd, s.args, { cwd: s.cwd, timeoutMs: s.timeoutMs || 120_000 });
    const ok = r.code === 0 && !r.timedOut;
    let detail = ok ? tail(r.stdout || r.stderr, 3) : tail(r.stderr || r.stdout, 12) || `exit ${r.code}`;
    if (!ok && r.error === 'ENOENT') detail = `${s.cmd} is not installed. Install it from ${s.cmd === 'git' ? INSTALL_PAGES.git : INSTALL_PAGES.rust}; this server does not run installers.`;
    if (r.timedOut) detail = `timed out after ${Math.round((s.timeoutMs || 120_000) / 1000)} s`;
    return { ok, detail, ms: r.ms };
  }
  if (s.kind === 'verify') {
    const exdir = path.join(s.cwd, 'docs', 'examples');
    const has = (n) => fs.existsSync(path.join(exdir, `${n}.settle`)) && fs.existsSync(path.join(exdir, `${n}.out`));
    // the named examples first; then any tested example of the same family, so a renamed file does not break setup
    const fallback = fs.existsSync(exdir) ? fs.readdirSync(exdir).filter((f) => f.startsWith(`${s.family}-`) && f.endsWith('.out')).map((f) => f.slice(0, -4)).sort() : [];
    const name = [...s.names, ...fallback].find(has);
    if (!name) return { ok: false, detail: `none of ${s.names.join(', ')} with a stored .out is in docs/examples` };
    const prog = path.join('docs', 'examples', `${name}.settle`);
    const want = fs.readFileSync(path.join(s.cwd, 'docs', 'examples', `${name}.out`), 'utf8');
    const r = await run(s.bin, [prog], { cwd: s.cwd, timeoutMs: 120_000 });
    const ok = r.code === 0 && r.stdout === want;
    return { ok, detail: ok ? `${name}: output matches docs/examples/${name}.out` : `${name}: output differs from the stored .out (exit ${r.code})\n${tail(r.stderr || r.stdout, 8)}`, ran: r.shown };
  }
  if (s.kind === 'verify-kanerva') {
    const pdir = path.join(s.cwd, 'programs');
    const name = s.names.find((n) => fs.existsSync(path.join(pdir, `${n}.kanerva`)) && fs.existsSync(path.join(pdir, `${n}.out`)));
    // a KANERVA from before the file face (2026-10-06) has no command and no programs: say so, and go on
    if (!name || !fs.existsSync(s.bin)) return { ok: true, detail: 'skipped: this KANERVA has no kanerva command or no programs/*.kanerva (it is older than the file face); run_kanerva will not be available' };
    const want = fs.readFileSync(path.join(pdir, `${name}.out`), 'utf8');
    const r = await run(s.bin, [path.join('programs', `${name}.kanerva`)], { cwd: s.cwd, timeoutMs: 120_000 });
    const ok = r.code === 0 && r.stdout === want;
    return { ok, detail: ok ? `${name}.kanerva: output matches programs/${name}.out` : `${name}.kanerva: output differs from the stored .out (exit ${r.code})\n${tail(r.stderr || r.stdout, 8)}`, ran: r.shown };
  }
  if (s.kind === 'state') return { ok: true, detail: `wrote ${s.to}` };
  return { ok: false, detail: `unknown step kind ${s.kind}` };
}

export async function runSetup(plan, { onStep } = {}) {
  const results = [];
  for (const [i, s] of plan.steps.entries()) {
    onStep?.({ index: i, step: s, status: 'running' });
    let res;
    try {
      if (s.kind === 'state') writeState({ folder: plan.folder, settle_bin: plan.settle_bin, kanerva_dir: plan.kanerva_dir, kanerva_bin: plan.kanerva_bin, set_up: new Date().toISOString() });
      res = await doStep(s);
    } catch (e) {
      res = { ok: false, detail: e.message };
    }
    const row = { n: i + 1, label: s.label, shown: s.shown, status: res.ok ? 'ok' : 'failed', detail: res.detail, ...(res.ms != null ? { ms: res.ms } : {}) };
    results.push(row);
    onStep?.({ index: i, step: s, status: row.status, row });
    if (!res.ok) break;
  }
  const done = results.length === plan.steps.length && results.every((r) => r.status === 'ok');
  return { done, results, skipped: plan.steps.slice(results.length).map((s, k) => ({ n: results.length + k + 1, label: s.label, shown: s.shown, status: 'not run' })) };
}

const jobs = new Map();
export function startSetupJob(plan) {
  const id = `setup-${plan.id}-${Date.now().toString(36)}`;
  const job = { id, plan, state: 'running', rows: [], current: null, started: new Date().toISOString(), result: null };
  jobs.set(id, job);
  job.promise = runSetup(plan, {
    onStep: (e) => {
      job.current = e.status === 'running' ? e.step.label : null;
      if (e.row) job.rows.push(e.row);
    },
  }).then((result) => {
    job.result = result;
    job.state = result.done ? 'done' : 'failed';
    return result;
  });
  return job;
}
export function jobStatus(id) {
  return jobs.get(id) || null;
}
export function lastJob() {
  return [...jobs.values()].pop() || null;
}
