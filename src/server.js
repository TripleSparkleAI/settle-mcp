// server.js - the SETTLE MCP server: help and docs, setup, and usage tools for SETTLE and KANERVA.
//
// <claudes_code_comments>
// ** Function List **
// SDK_VERSION                 - the @modelcontextprotocol/sdk version this server is built and tested against
// PARTS / TOOLS               - the three parts and every tool's name, part and description: the site's words
//                               (sites/settle-site/src/data/mcpDocs.js), read from content/docs.json
// TOOL_NAMES                  - the tools this file registers, in order; startup fails if the site's list differs
// text(s, data)               - a tool result: readable text plus the same facts as structuredContent
// overview(content)           - the help page with no topic: the three parts, every tool, resources and prompts
// planMarkdown(plan)          - a setup plan as numbered lines, every command written out
// rowsMarkdown(rows)          - setup results, one line per step
// createServer({ contentFile }) - an McpServer with every tool, resource and prompt registered
//
// ** Technical Review **
// - THE THREE PARTS (the navigator, 2026-10-01): PART ONE is docs and help and needs nothing installed (help,
//   read_doc, list_examples, get_example, explain_error, the resources, the prompts). PART TWO sets SETTLE and
//   KANERVA up on the user's machine (check_system, setup, setup_status). PART THREE uses them (run_program,
//   sdm_store_recall, kanerva_quickstart). THE WEBSITE IS THE SOURCE OF TRUTH: the descriptions are the #/mcp page's
//   own words, so the page and the server can never describe a tool two ways.
// - setup is dry-run by default. A real run needs dry_run false and confirm equal to the plan id the dry run
//   returned, so a person sees every command before anything runs. A long build continues in the background past
//   wait_seconds; setup_status reports it.
// - Resources: settle-mcp://agents (AGENTS.md, lane WHOYOUARE), settle-mcp://help, settle-mcp://glossary, settle-mcp://usage, settle-mcp://setup, one resource per
//   SETTLE and KANERVA doc (settle://docs/..., settle://readme, kanerva://readme, kanerva://terms when present), and
//   the template settle://examples/{name} for every tested example.
// - The glossary is content/docs.json's (parsed from the repo's docs at build time) plus this server's own tool
//   names, so `help` can answer "what is run_program" and "what is a lean" from one place.
// </claudes_code_comments>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadContent, findDoc, glossaryMarkdown, lookupTerm, findExample, explainError } from './content.js';
import { checkSystem, planSetup, startSetupJob, jobStatus, lastJob, readState, statePath } from './setup.js';
import { runProgram, sdmStoreRecall, kanervaQuickstart, resolveSettle } from './usage.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
export const SDK_VERSION = PKG.dependencies['@modelcontextprotocol/sdk'];
export const SERVER_NAME = 'settle-mcp';
export const SERVER_VERSION = PKG.version;

// the parts and the tool descriptions are the site's words (sites/settle-site/src/data/mcpDocs.js), carried in
// content/docs.json by the build; the server owns only the names, their order and their input schemas
const MCP = loadContent().mcp;
export const PARTS = Object.fromEntries(MCP.parts.map((p) => [p.n, `${p.title}: ${p.line}`]));
export const TOOLS = MCP.tools;
export const TOOL_NAMES = ['help', 'read_doc', 'list_examples', 'get_example', 'explain_error', 'check_system', 'setup', 'setup_status', 'run_program', 'sdm_store_recall', 'kanerva_quickstart'];
const sameNames = TOOLS.map((t) => t.name).join(',') === TOOL_NAMES.join(',');
if (!sameNames) throw new Error(`settle-mcp: the site's tool list (${TOOLS.map((t) => t.name).join(', ')}) differs from the server's (${TOOL_NAMES.join(', ')}); fix sites/settle-site/src/data/mcpDocs.js and rebuild`);

const toolDesc = (n) => TOOLS.find((t) => t.name === n).description;

export function text(s, data) {
  return { content: [{ type: 'text', text: s }], ...(data ? { structuredContent: data } : {}) };
}

export function overview(content) {
  const by = (p) => TOOLS.filter((t) => t.part === p).map((t) => `- \`${t.name}\`: ${t.description}`).join('\n');
  const state = readState();
  const settle = resolveSettle();
  return [
    `# settle-mcp ${SERVER_VERSION}`,
    '',
    'SETTLE is a small language for settling machines: you name yes-or-no things, give them leans and pulls, and let the machine settle. KANERVA is the Rust crate for Sparse Distributed Memory that SETTLE uses: write long patterns of bits, read one back from a noisy read-address.',
    '',
    `## PART ONE · ${PARTS[1]}`,
    by(1),
    '',
    `## PART TWO · ${PARTS[2]}`,
    by(2),
    '',
    `## PART THREE · ${PARTS[3]}`,
    by(3),
    '',
    '## Where to start',
    '0. Read `settle-mcp://agents` (AGENTS.md), then the WHO YOU ARE guide for the person you are helping: `site://who-you-are/for-programmers`, `site://who-you-are/for-visual-artists` or `site://who-you-are/for-sound-artists` (`read_doc` takes the name).',
    '1. `help` with a topic, for example `help {"topic": "lean"}` or `help {"topic": "glossary"}`.',
    '2. `check_system`, then `setup` with `folder` and `settle_source` (a local folder or a git URL you were given; nothing is published yet). Read the plan, then run it with its id.',
    '3. `run_program` with a tested example from `list_examples`, then `sdm_store_recall`.',
    '',
    '## Resources and prompts',
    `- ${content.docs.length} documents as resources (settle://docs/..., settle://readme, kanerva://readme${content.docs.some((d) => d.uri === 'kanerva://terms') ? ', kanerva://terms' : ''}, and the site pages as site://...), the glossary (settle-mcp://glossary), usage (settle-mcp://usage) and setup (settle-mcp://setup) notes, and settle://examples/{name} for ${content.examples.length} tested examples.`,
    '- Prompts: `explain-settling`, `write-settle-program`, `sdm-store-recall`.',
    '',
    '## On this machine',
    settle.bin ? `- SETTLE is built: ${settle.bin} (found through ${settle.how}).` : '- SETTLE is not built yet. PART ONE works without it.',
    state ? `- The last setup was in ${state.folder} (${state.set_up}).` : `- No setup recorded yet (${statePath()}).`,
    `- The glossary holds ${content.glossary.length} names, built from the site and its docs (inputs ${content.hash.slice(0, 12)}).`,
  ].join('\n');
}

export function planMarkdown(plan) {
  return [
    `Plan ${plan.id} for ${plan.folder}`,
    '',
    ...plan.steps.map((s, i) => `${i + 1}. ${s.label}\n   ${s.shown}`),
    ...(plan.notes.length ? ['', 'Notes:', ...plan.notes.map((n) => `- ${n}`)] : []),
    '',
    `Nothing has run. To run exactly these steps: setup with the same arguments, dry_run false, confirm "${plan.id}".`,
  ].join('\n');
}

export function rowsMarkdown(rows) {
  return rows.map((r) => `${r.n}. [${r.status}] ${r.label}\n   ${r.shown}${r.detail ? `\n   ${String(r.detail).split('\n').join('\n   ')}` : ''}`).join('\n');
}

const docMime = 'text/markdown';

export function createServer({ contentFile } = {}) {
  const content = loadContent(contentFile);
  const extraGlossary = [];
  // the instructions every client reads at initialize: the site's words (tools/build_mcp_docs.mjs instructionsText), which
  // send a client to AGENTS.md and the WHO YOU ARE guide for its reader first (lane WHOYOUARE)
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: MCP.instructions ?? 'Start with the help tool. setup is a dry run until you pass dry_run false with the plan id it returned as confirm.' });

  // ── PART ONE · docs and help ───────────────────────────────────────────────────────────────
  server.registerTool('help', { title: 'Help', description: toolDesc('help'), inputSchema: { topic: z.string().optional().describe('a word to look up, "glossary" for every name, or a tool name') } }, async ({ topic }) => {
    if (!topic) return text(overview(content), { parts: PARTS, tools: TOOLS });
    if (/^glossary$/i.test(topic.trim())) {
      const all = [...content.glossary, ...extraGlossary];
      return text(`# Glossary (${all.length} names)\n\n${glossaryMarkdown(all)}`, { count: all.length, entries: all });
    }
    const hits = lookupTerm(content, topic, extraGlossary);
    const doc = findDoc(content, topic);
    if (!hits.length && !doc) return text(`Nothing in the glossary or the docs is named "${topic}". Try help {"topic": "glossary"} for every name.`, { topic, entries: [] });
    const body = [hits.length ? glossaryMarkdown(hits) : '', doc ? `See also the document ${doc.uri} (${doc.title}).` : ''].filter(Boolean).join('\n');
    return text(`# ${topic}\n\n${body}`, { topic, entries: hits, doc: doc ? doc.uri : null });
  });

  server.registerTool('read_doc', { title: 'Read a document', description: toolDesc('read_doc'), inputSchema: { name: z.string().optional().describe('a doc name, uri or title word') } }, async ({ name }) => {
    if (!name) return text(content.docs.map((d) => `- ${d.uri}: ${d.title}`).join('\n'), { docs: content.docs.map((d) => ({ uri: d.uri, title: d.title, path: d.path })) });
    const d = findDoc(content, name);
    if (!d) return text(`No document matches "${name}". Call read_doc with no name to list them.`, { found: false });
    return text(d.text, { uri: d.uri, title: d.title, path: d.path });
  });

  server.registerTool(
    'list_examples',
    { title: 'List examples', description: toolDesc('list_examples'), inputSchema: { family: z.string().optional().describe('a statement family, for example core, memory, sdm'), kind: z.enum(['ok', 'error']).optional() } },
    async ({ family, kind }) => {
      const list = content.examples.filter((e) => (!family || e.name.startsWith(`${family}-`)) && (!kind || e.kind === kind));
      return text(list.map((e) => `- ${e.name}${e.kind === 'error' ? ' (an error example)' : ''}: ${e.title}`).join('\n') || 'No example matches.', { count: list.length, examples: list.map(({ name, title, kind: k }) => ({ name, title, kind: k })) });
    },
  );

  server.registerTool('get_example', { title: 'Get an example', description: toolDesc('get_example'), inputSchema: { name: z.string().describe('the example name, for example core-ask') } }, async ({ name }) => {
    const e = findExample(content, name);
    if (!e) return text(`No tested example is named "${name}". Call list_examples.`, { found: false });
    const outLabel = e.kind === 'error' ? 'Its tested error (standard error)' : 'Its tested output';
    return text(`# ${e.name}\n\n\`\`\`settle\n${e.source}\`\`\`\n\n${outLabel}:\n\n\`\`\`\n${e.kind === 'error' ? e.err : e.out}\`\`\``, { name: e.name, kind: e.kind, source: e.source, out: e.out, err: e.err });
  });

  server.registerTool(
    'explain_error',
    { title: 'Explain an error', description: toolDesc('explain_error'), inputSchema: { message: z.string().describe('the error text, for example "settle: line 6: a string is missing its closing quote"'), source: z.string().optional().describe('the program text, to show the line the error names') } },
    async ({ message, source }) => {
      const r = explainError(content, message);
      const lines = [`# ${r.message}`, ''];
      if (r.line && source) lines.push(`Line ${r.line} of your program: \`${(source.split('\n')[r.line - 1] || '').trim()}\``, '');
      if (r.matches.length) for (const m of r.matches) lines.push(`- \`${m.message}\`: ${m.cause} _(${m.doc})_`);
      else lines.push('This message is not in the error tables. Each statement family lists its own errors on its page: read_doc with the family name (for example "sdm").');
      for (const e of r.examples) lines.push('', `A tested program that gives this error, ${e.name}:`, '```settle', e.source.trimEnd(), '```');
      return text(lines.join('\n'), r);
    },
  );

  // ── PART TWO · setup ───────────────────────────────────────────────────────────────────────
  server.registerTool('check_system', { title: 'Check the system', description: toolDesc('check_system'), inputSchema: {} }, async () => {
    const r = await checkSystem();
    const lines = r.checks.map((c) => `- ${c.tool}: ${c.found ? c.version : 'not found'}  (ran \`${c.ran}\`; needed ${c.needed})${c.fix ? `\n  ${c.fix}` : ''}`);
    return text(`Platform ${r.platform}\n${lines.join('\n')}\n\n${r.ready ? 'Ready to build SETTLE.' : 'Not ready: install what is missing first.'}`, r);
  });

  server.registerTool(
    'setup',
    {
      title: 'Set up SETTLE and KANERVA',
      description: toolDesc('setup'),
      inputSchema: {
        folder: z.string().describe('where to put settle-rs and kanerva, for example ~/settle'),
        settle_source: z.string().describe('a local folder holding settle-rs (or a repository containing it), or a git URL you were given. Nothing is published yet, so there is no default.'),
        kanerva_source: z.string().optional().describe('where kanerva is, if it is not beside settle-rs in the same source'),
        build_quickstart: z.boolean().optional().describe('also build the KANERVA quickstart example (default true)'),
        dry_run: z.boolean().optional().describe('default true: show the plan, run nothing'),
        confirm: z.string().optional().describe('the plan id from the dry run; required to run'),
        wait_seconds: z.number().min(0).max(600).optional().describe('how long to wait before returning while it runs (default 50); setup_status reports the rest'),
      },
    },
    async (args) => {
      let plan;
      try {
        plan = planSetup(args);
      } catch (e) {
        return text(e.message, { ok: false, error: e.message });
      }
      if (args.dry_run !== false) return text(planMarkdown(plan), { dry_run: true, plan_id: plan.id, folder: plan.folder, steps: plan.steps.map((s) => ({ label: s.label, command: s.shown })), notes: plan.notes });
      if (args.confirm !== plan.id) return text(`Not run. confirm must be the plan id of these exact steps, "${plan.id}". Run setup with dry_run true to read them first.\n\n${planMarkdown(plan)}`, { ok: false, error: 'confirm-mismatch', plan_id: plan.id });
      const job = startSetupJob(plan);
      const waitMs = (args.wait_seconds ?? 50) * 1000;
      await Promise.race([job.promise, new Promise((r) => setTimeout(r, waitMs))]);
      const state = job.state;
      const head = state === 'done' ? `Setup finished. SETTLE is at ${plan.settle_bin}.` : state === 'failed' ? 'Setup stopped at a failed step.' : `Setup is still running (now: ${job.current || 'between steps'}). Call setup_status {"job": "${job.id}"}.`;
      return text(`${head}\n\n${rowsMarkdown(job.rows)}`, { job: job.id, state, steps: job.rows, settle_bin: plan.settle_bin });
    },
  );

  server.registerTool('setup_status', { title: 'Setup status', description: toolDesc('setup_status'), inputSchema: { job: z.string().optional() } }, async ({ job }) => {
    const j = job ? jobStatus(job) : lastJob();
    if (!j) {
      const s = readState();
      return text(s ? `No setup has run in this session. The last recorded setup: ${s.folder}, binary ${s.settle_bin}, at ${s.set_up}.` : 'No setup has run, and none is recorded.', { state: s ? 'recorded' : 'none', recorded: s });
    }
    const left = j.result?.skipped?.length ? `\n\nNot run:\n${rowsMarkdown(j.result.skipped)}` : '';
    return text(`${j.id}: ${j.state}${j.current ? ` (now: ${j.current})` : ''}\n\n${rowsMarkdown(j.rows)}${left}`, { job: j.id, state: j.state, steps: j.rows });
  });

  // ── PART THREE · usage ─────────────────────────────────────────────────────────────────────
  server.registerTool(
    'run_program',
    {
      title: 'Run a SETTLE program',
      description: toolDesc('run_program'),
      inputSchema: {
        path: z.string().optional().describe('a .settle file'),
        source: z.string().optional().describe('program text, if there is no file'),
        settle: z.string().optional().describe('the settle binary to use (default: the one setup built)'),
        timeout_ms: z.number().int().min(1000).max(600000).optional(),
      },
    },
    async (args) => {
      const r = await runProgram(args);
      if (r.error) return text(r.error + (r.tried ? `\nLooked in: ${r.tried.join('; ')}` : ''), r);
      const out = [`ran: ${r.ran}`, `exit ${r.exit}${r.timedOut ? ' (timed out)' : ''} in ${r.ms} ms`, '', r.stdout ? `\`\`\`\n${r.stdout}\`\`\`` : '(no output)'];
      if (r.stderr) out.push('', 'standard error:', `\`\`\`\n${r.stderr}\`\`\``, '', 'explain_error can say what this error means.');
      return text(out.join('\n'), r);
    },
  );

  server.registerTool(
    'sdm_store_recall',
    {
      title: 'Store and recall with an SDM',
      description: toolDesc('sdm_store_recall'),
      inputSchema: {
        patterns: z.array(z.object({ name: z.string().describe('a plain word: letters, digits, _'), text: z.string().optional().describe('a short text to store under the name') })).min(1).max(200),
        read: z.string().describe('the name to read back'),
        noise: z.number().min(0).max(0.5).optional().describe('the fraction of the read-address bits flipped before the read (default 0.2)'),
        size: z.number().int().min(8).max(4096).optional().describe('bits per pattern, the sdm statement\'s word-size: (default 256)'),
        locations: z.number().int().min(10).max(100000).optional().describe('the sdm statement\'s hard-locations: (default 2000)'),
        seed: z.number().int().min(0).optional(),
        reads: z.number().int().min(1).max(20).optional().describe('how many reads, each with its own seed (default 1)'),
        settle: z.string().optional(),
      },
    },
    async (args) => {
      const r = await sdmStoreRecall(args);
      if (r.error) return text(r.error, r);
      return text([`The program (keywords read from ${r.keywordsFrom}):`, '```settle', r.program.trimEnd(), '```', '', `ran: ${r.ran}`, '```', (r.stdout || r.stderr).trimEnd(), '```'].join('\n'), r);
    },
  );

  server.registerTool(
    'kanerva_quickstart',
    { title: 'KANERVA quickstart', description: toolDesc('kanerva_quickstart'), inputSchema: { kanerva: z.string().optional().describe('the kanerva crate folder (default: the one setup made)'), dry_run: z.boolean().optional() } },
    async (args) => {
      const r = await kanervaQuickstart(args);
      if (r.error) return text(r.error, r);
      if (r.dry_run) return text(`Would run: ${r.would_run}`, r);
      return text(`ran: ${r.ran}\nexit ${r.exit}\n\n\`\`\`\n${(r.stdout || r.stderr).trimEnd()}\n\`\`\``, r);
    },
  );

  // ── resources ──────────────────────────────────────────────────────────────────────────────
  const pkgDoc = (f) => fs.readFileSync(path.join(PKG_DIR, 'docs', f), 'utf8');
  const agentsPath = path.join(PKG_DIR, 'AGENTS.md');
  server.registerResource('agents', 'settle-mcp://agents', { title: 'AGENTS.md: who you are, what this is, where each reader starts', description: 'The main agent document, generated from the site', mimeType: docMime }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: docMime, text: fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : 'AGENTS.md is missing: run `npm run build-docs` in the settle-mcp folder.' }],
  }));
  server.registerResource('help', 'settle-mcp://help', { title: 'settle-mcp help', description: 'The three parts, every tool, where to start', mimeType: docMime }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: docMime, text: overview(content) }] }));
  server.registerResource('glossary', 'settle-mcp://glossary', { title: 'Glossary', description: 'Every SETTLE, KANERVA and settle-mcp name, from the docs', mimeType: docMime }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: docMime, text: `# Glossary\n\n${glossaryMarkdown([...content.glossary, ...extraGlossary])}` }],
  }));
  server.registerResource('usage', 'settle-mcp://usage', { title: 'Using SETTLE and KANERVA through this server', mimeType: docMime }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: docMime, text: pkgDoc('USAGE.md') }] }));
  server.registerResource('setup-notes', 'settle-mcp://setup', { title: 'Setting SETTLE and KANERVA up', mimeType: docMime }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: docMime, text: pkgDoc('SETUP.md') }] }));
  for (const d of content.docs) {
    server.registerResource(d.uri, d.uri, { title: d.title, description: d.path, mimeType: docMime }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: docMime, text: d.text }] }));
  }
  server.registerResource(
    'example',
    new ResourceTemplate('settle://examples/{name}', { list: async () => ({ resources: content.examples.map((e) => ({ uri: `settle://examples/${e.name}`, name: e.name, description: e.title, mimeType: 'text/plain' })) }) }),
    { title: 'A tested SETTLE example', mimeType: 'text/plain' },
    async (uri, { name }) => {
      const e = findExample(content, name);
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: e ? `${e.source}\n# --- ${e.kind === 'error' ? 'tested error' : 'tested output'} ---\n${e.kind === 'error' ? e.err : e.out}` : `no example named ${name}` }] };
    },
  );

  // ── prompts ────────────────────────────────────────────────────────────────────────────────
  const userMsg = (t) => ({ messages: [{ role: 'user', content: { type: 'text', text: t } }] });
  server.registerPrompt('explain-settling', { title: 'Explain settling', description: 'Explain what it means for a SETTLE machine to settle, with the tour and the semantics as sources' }, async () => {
    const tour = findDoc(content, '02-tour');
    return userMsg(`Explain, in plain words and then precisely, what it means for a SETTLE machine to settle: things, leans, pulls, energy, temperature, and what ask reports. Use only the documentation below, and quote the example it gives.\n\n${tour ? tour.text : ''}`);
  });
  server.registerPrompt('write-settle-program', { title: 'Write a SETTLE program', description: 'Write a SETTLE program for a task, using the syntax and statement docs', argsSchema: { task: z.string().describe('what the program should do') } }, async ({ task }) => {
    const syntax = findDoc(content, '03-syntax');
    const core = findDoc(content, 'core');
    return userMsg(`Write a SETTLE program that does this: ${task}\n\nUse only statements documented below. Then run it with the run_program tool and explain its output. If it fails, use explain_error.\n\n${syntax ? syntax.text : ''}\n\n${core ? core.text : ''}`);
  });
  server.registerPrompt('sdm-store-recall', { title: 'Store and recall with an SDM', description: 'Store some memories in a sparse distributed memory and recall one from a noisy read-address', argsSchema: { what: z.string().optional().describe('what to store, in plain words') } }, async ({ what }) => {
    const sdm = findDoc(content, 'sdm');
    return userMsg(`Store ${what || 'a few short memories'} in a sparse distributed memory with the sdm_store_recall tool, then read one back with 20% of its read-address scrambled, and again at 40%. Explain which reads came back and why, using the document below.\n\n${sdm ? sdm.text : ''}`);
  });

  return server;
}
