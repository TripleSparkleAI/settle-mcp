// exec.js - run one program with its arguments, never through a shell, and say exactly what ran.
//
// <claudes_code_comments>
// ** Function List **
// shellQuote(s)                    - one argument quoted for display, the way a shell would need it
// showCommand(cmd, args, cwd)      - the command as a person would type it: "(cd DIR && cmd 'arg' ...)"
// refuseSudo(cmd, args)            - throws when a command would escalate privilege (sudo, su, doas)
// run(cmd, args, { cwd, timeoutMs, env, input }) - spawn without a shell; resolves { code, stdout, stderr,
//                                    timedOut, ms, shown }; a missing program resolves code null + error
// tail(text, lines)                - the last lines of an output, for a short report
//
// ** Technical Review **
// - No shell: spawn(cmd, args) passes each argument as one argv entry, so a path with a space or a quote
//   cannot turn into a second command. The displayed form is built separately, only for people to read.
// - THE NO-SUDO RULE lives here as code: every command passes refuseSudo before it runs, so a plan that
//   somehow carried a privileged command would stop at the door.
// - A timeout kills the child with SIGTERM and reports timedOut: true; nothing is retried.
// </claudes_code_comments>

import { spawn } from 'node:child_process';

export function shellQuote(s) {
  const v = String(s);
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`;
}

export function showCommand(cmd, args = [], cwd) {
  const line = [cmd, ...args].map(shellQuote).join(' ');
  return cwd ? `(cd ${shellQuote(cwd)} && ${line})` : line;
}

const PRIVILEGED = new Set(['sudo', 'su', 'doas', 'pkexec', 'runas']);
export function refuseSudo(cmd, args = []) {
  const base = String(cmd).split('/').pop();
  if (PRIVILEGED.has(base) || args.some((a) => PRIVILEGED.has(String(a)))) {
    throw new Error(`refused: settle-mcp never runs privileged commands (${showCommand(cmd, args)})`);
  }
}

export function run(cmd, args = [], { cwd, timeoutMs = 120_000, env, input } = {}) {
  refuseSudo(cmd, args);
  const shown = showCommand(cmd, args, cwd);
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: String(e.message), timedOut: false, ms: 0, shown, error: e.code || 'spawn-failed' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(e.message), timedOut, ms: Date.now() - started, shown, error: e.code || 'spawn-failed' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started, shown });
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function tail(text, lines = 12) {
  const all = String(text || '').trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}
