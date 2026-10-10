// exec.js - run one program with its arguments, never through a shell, and say exactly what ran.
//
// <claudes_code_comments>
// ** Function List **
// shellQuote(s)                    - one argument quoted for display, the way a shell would need it
// showCommand(cmd, args, cwd)      - the command as a person would type it: "(cd DIR && cmd 'arg' ...)"
// refuseSudo(cmd, args)            - throws when a command would escalate privilege (sudo, su, doas)
// run(cmd, args, { cwd, timeoutMs, env, input, maxOutput }) - spawn without a shell; resolves { code, stdout, stderr,
//                                    timedOut, ms, shown }; a missing program resolves code null + error
// tail(text, lines)                - the last lines of an output, for a short report
//
// ** Technical Review **
// - No shell: spawn(cmd, args) passes each argument as one argv entry, so a path with a space or a quote
//   cannot turn into a second command. The displayed form is built separately, only for people to read.
// - THE NO-SUDO RULE lives here as code: every command passes refuseSudo before it runs, so a plan that
//   somehow carried a privileged command would stop at the door.
// - A timeout stops the child with SIGTERM, then SIGKILL after KILL_GRACE_MS, and reports timedOut: true; nothing is
//   retried. The child runs in its own process group, and the signals go to the whole group. Output past MAX_OUTPUT (1 MB per stream) is dropped, the child is stopped, and the result says truncated.
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

// the most of a child's stdout (and, separately, its stderr) that is kept; past it the child is stopped and the
// result says truncated, so a program that prints without end cannot fill this process's memory
export const MAX_OUTPUT = 1024 * 1024;
// how long a child that ignores SIGTERM gets before SIGKILL
export const KILL_GRACE_MS = 2000;
const GROUPS = process.platform !== 'win32';

export function run(cmd, args = [], { cwd, timeoutMs = 120_000, env, input, maxOutput = MAX_OUTPUT } = {}) {
  refuseSudo(cmd, args);
  const shown = showCommand(cmd, args, cwd);
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      // its own process group (not on Windows), so a stop reaches the programs it starts too (cargo's rustc, a shell's
      // children); otherwise a grandchild holding the output pipe keeps the run open past its timeout
      child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: GROUPS });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: String(e.message), timedOut: false, ms: 0, shown, error: e.code || 'spawn-failed' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let truncated = false;
    let killer = null;
    const signal = (sig) => {
      try {
        if (GROUPS && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* already gone */
        }
      }
    };
    const stop = () => {
      signal('SIGTERM');
      killer ??= setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const keep = (which) => (d) => {
      const cur = which === 'out' ? stdout : stderr;
      if (cur.length >= maxOutput) return;
      const next = cur + d;
      const kept = next.length > maxOutput ? next.slice(0, maxOutput) : next;
      if (next.length > maxOutput) {
        truncated = true;
        stop();
      }
      if (which === 'out') stdout = kept;
      else stderr = kept;
    };
    child.stdout.on('data', keep('out'));
    child.stderr.on('data', keep('err'));
    const done = () => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
    };
    child.on('error', (e) => {
      done();
      resolve({ code: null, stdout, stderr: stderr + String(e.message), timedOut, ms: Date.now() - started, shown, error: e.code || 'spawn-failed' });
    });
    child.on('close', (code) => {
      done();
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started, shown, ...(truncated ? { truncated: true } : {}) });
    });
    child.stdin.on('error', () => {}); // a child that exits before reading its input must not crash the server
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function tail(text, lines = 12) {
  const all = String(text || '').trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}
