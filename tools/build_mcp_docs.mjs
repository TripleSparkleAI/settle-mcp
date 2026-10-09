#!/usr/bin/env node
// build_mcp_docs.mjs - generate every doc settle-mcp serves from the SETTLE site, which is the source of truth.
//
// <claudes_code_comments>
// ** Function List **
// repoRoot()                     - the dwarfstar checkout this package sits in (SETTLE_MCP_REPO_ROOT overrides)
// INPUTS                         - the site sources read, by role: the MCP page data, the site's English catalogue,
//                                  its vocabulary, the page files, the SETTLE docs, the KANERVA README and terms
// readInputs(root, override)     - every input as { path, text }; override maps a path to replacement text (tests)
// jsxProse(src)                  - a page file's prose: Section labels and titles, headings, paragraphs, quotes
// docsFrom(...) / examplesFrom(...) - the SETTLE docs and their tested examples
// statementRows / familyRows / tokenRows / boldDefinitions / moduleRows / termsTables / vocabularyRows - glossary
//                                  readers, one per kind of source
// loadBanner(root)               - SETTLE/tools/readme_banner.mjs, the repository banner tool, or null when absent
// loadWtf(root) / wtfRows(w) / wtfMd(w) - the site's glossary (src/wtf/terms.js, #/glossary), imported as a module:
//                                  one glossary row per term, and the whole index as docs/site/glossary.md
// buildAll({ root, override })   - { files: { relPath: text }, hash, inputs } : every generated file, in memory
// inputsHash({ root, override }) - the content hash of what the build reads (cheap; the server checks it on start)
// agentsMd(...) / instructionsText(...) - AGENTS.md (the main agent document) and the server's initialize instructions,
//                                  both from the WHO YOU ARE guides and the MCP's own words
// siteAgentFiles(D, files, docs) - the site's files for agents: /llms.txt (also at /.well-known/llms.txt), /llms-full.txt,
//                               /llms/** and /robots.txt
// llmsPath(uri)                  - where a document's Markdown mirror sits under the site's public/llms/
// readmeMd / installMd / agentMd - the README, docs/INSTALL.md and one agent's install guide
// kanervaProgramDocs(files)      - the kanerva command's programs/*.kanerva, each with its recorded output, as documents
// writeAll(build)                - writes the files under this package and the site's agent files
// isStale({ root })              - true when the generated files on disk differ from a fresh build
// ensureFresh()                  - rebuild when the inputs exist and their hash differs from content/inputs.json
// main                           - `node tools/build_mcp_docs.mjs` writes; `--check` exits 1 when stale
//
// ** Technical Review **
// - THE WEBSITE IS THE SOURCE OF TRUTH (the navigator, 2026-10-01). README.md, AGENTS.md, docs/*.md, docs/site/*.md,
//   docs/who-you-are/**/*.md (the three audience guides, lane WHOYOUARE),
//   content/docs.json (the search index the help tool serves) and content/inputs.json (the hashes) are all written
//   here and never by hand. The MCP's own words live in SETTLE/settle-site/src/data/mcpDocs.js, which the #/mcp page
//   renders; the tool descriptions the server registers come from there too.
// - THE HASH is over what the build EXTRACTS from each input (a page's prose, a catalogue's text), not the file
//   bytes, so a code change in a page that moves no prose does not mark the docs stale. inputs.json keeps one sha256
//   per input and the hash of the whole list. tests/mcpdocs.test.mjs in the site fails while a fresh build differs
//   from the files on disk, with a positive control that changes one site string in memory.
// - THE PAGE READER is a careful regex walk, not a parser: it keeps Section label/title attributes, h1-h4, p and
//   blockquote text, turns t('id', 'English') into its English, <b> into **, <i> into *, <code> into backticks, and
//   drops any other {expression}. A paragraph left with markup in it is skipped rather than half-shown.
// - Outputs carry no timestamp, so two builds of the same site are byte-identical.
// - In a standalone copy of the package (no site beside it) nothing is rebuilt; the committed files are served.
// - THE BANNER (lane REPOBANNERS, 2026-10-09): the README opens with the settle banner every exported repository wears,
//   written here through SETTLE/tools/readme_banner.mjs (withBanner, the same block its --write puts on the other
//   seven READMEs), never by hand. The SETTLE and KANERVA READMEs this build serves to agents have their banner
//   stripped, and so does this package's own README where the site mirrors it for agents (llms/settle-mcp, llms-full):
//   it decorates a repository's front page and carries nothing an agent needs. The banner's text is one of
//   the hashed inputs, so a changed description re-stales the docs.
// </claudes_code_comments>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG = path.resolve(HERE, '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function repoRoot() {
  return process.env.SETTLE_MCP_REPO_ROOT || path.resolve(PKG, '..', '..');
}

const SITE = 'SETTLE/settle-site';
const TR = 'SETTLE';
export const INPUTS = {
  mcp: `${SITE}/src/data/mcpDocs.js`,
  strings: `${SITE}/i18n/en.json`,
  vocabulary: `${SITE}/i18n/GLOSSARY.md`,
  pages: [
    ['what', `${SITE}/src/pages/What.jsx`, 'WHAT? the tutorial'],
    ['language', `${SITE}/src/pages/Language.jsx`, 'the language page'],
    ['kanerva', `${SITE}/src/pages/Kanerva.jsx`, 'the KANERVA page'],
    ['kanerva-first-steps', `${SITE}/src/pages/kanerva/FirstSteps.jsx`, 'KANERVA: first steps'],
    ['kanerva-analogies', `${SITE}/src/pages/kanerva/Analogies.jsx`, 'KANERVA: the dollar of Mexico'],
    ['sdmmemory', `${SITE}/src/pages/SdmMemory.jsx`, 'the SDMMEMORY page'],
    ['sdmexplore', `${SITE}/src/pages/SdmExplore.jsx`, 'the SDM explore page'],
    ['mcp', `${SITE}/src/pages/Mcp.jsx`, 'the settle-mcp page'],
  ],
  settleDocs: `${TR}/settle-rs/docs`,
  settleReadme: `${TR}/settle-rs/README.md`,
  kanervaReadme: `${TR}/kanerva/README.md`,
  kanervaTerms: `${TR}/kanerva/KANERVA_TERMS.md`,
  kanervaPrograms: `${TR}/kanerva/programs`,
  wtf: `${SITE}/src/wtf/terms.js`,
  banner: `${TR}/tools/readme_banner.mjs`,
  whoYouAre: `${SITE}/docs/who-you-are`,
};
// WHO YOU ARE (lane WHOYOUARE, 2026-10-02): the three audience guides, in the order the site shows them
export const AUDIENCES = ['for-programmers', 'for-visual-artists', 'for-sound-artists'];

function walk(dir, keep) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, keep));
    else if (keep(e.name, p)) out.push(p);
  }
  return out;
}

export function readInputs(root = repoRoot(), override = {}) {
  const rd = (rel) => (rel in override ? override[rel] : fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const docFiles = walk(path.join(root, INPUTS.settleDocs), (n, p) => n.endsWith('.md') && !p.includes(`${path.sep}examples${path.sep}`)).map(rel);
  const exFiles = walk(path.join(root, INPUTS.settleDocs, 'examples'), (n) => /\.(settle|out|err)$/.test(n)).map(rel);
  return {
    mcpSrc: rd(INPUTS.mcp),
    strings: rd(INPUTS.strings),
    vocabulary: rd(INPUTS.vocabulary),
    pages: INPUTS.pages.map(([key, p, title]) => ({ key, path: p, title, text: rd(p) })).filter((x) => x.text != null),
    settleDocs: docFiles.map((p) => ({ path: p, text: rd(p) })),
    examples: exFiles.map((p) => ({ path: p, text: rd(p) })),
    settleReadme: rd(INPUTS.settleReadme),
    kanervaReadme: rd(INPUTS.kanervaReadme),
    kanervaTerms: rd(INPUTS.kanervaTerms),
    kanervaPrograms: walk(path.join(root, INPUTS.kanervaPrograms), (n) => /\.(kanerva|out)$/.test(n)).map(rel).map((p) => ({ path: p, text: rd(p) })),
    whoYouAre: {
      index: rd(`${INPUTS.whoYouAre}/README.md`),
      guides: AUDIENCES.map((f) => ({ folder: f, path: `${INPUTS.whoYouAre}/${f}/README.md`, text: rd(`${INPUTS.whoYouAre}/${f}/README.md`) })).filter((g) => g.text != null),
    },
  };
}

// ── the page reader ─────────────────────────────────────────────────────────────────────────────
const ENT = { rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', amp: '&', minus: '-', le: '≤', ge: '≥', times: '×', middot: '·', nbsp: ' ', hellip: '…', larr: '←', rarr: '→', lt: '<', gt: '>', quot: '"', apos: "'", Sigma: 'Σ', alpha: 'α', beta: 'β', theta: 'θ', ndash: '-', mdash: '-' };
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m);
const STR = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
const unq = (lit) => lit.slice(1, -1).replace(/\\(.)/g, '$1');
// t('id', 'English' [+ 'more' ...] [, values]): the English may be split over lines with +
const T_CALL = new RegExp(String.raw`\bt\(\s*${STR}\s*,\s*(${STR}(?:\s*\+\s*${STR})*)\s*,?\s*(?:,[^)]*)?\)`, 'g');
const joinLits = (l) => [...l.matchAll(new RegExp(STR, 'g'))].map((x) => unq(x[0])).join('');

function cleanInner(s) {
  let x = s.replace(/\{\s*(['"])\s*\1\s*\}|\{\s*' '\s*\}|\{" "\}/g, ' ');
  x = x.replace(new RegExp(String.raw`\{\s*(${STR})\s*\}`, 'g'), (_, l) => unq(l));
  x = x.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_, c) => '`' + c + '`');
  x = x.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/g, '**$2**').replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/g, '*$2*');
  x = x.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g, '$1').replace(/<br\s*\/?>/g, ' ');
  x = x.replace(/<(span|sub|sup|abbr|kbd|small|mark)\b[^>]*>([\s\S]*?)<\/\1>/g, '$2');
  x = x.replace(/\{[^{}]*\}/g, '');
  // markup still left is a structure this reader does not know: drop the block rather than show it half-read
  if (/<\/?[A-Za-z]|=>|\b(className|onClick)=/.test(x)) return '';
  return decode(x).replace(/\s+/g, ' ').trim();
}

// {rich('id', 'English with <b>tags</b>', values, tags)} -> the English, a mapped tag (a link, a <explore>) read as
// its inner text and b/i/code kept for cleanInner; the call's further arguments are skipped by bracket depth (they may
// hold JSX with its own parentheses). Lane I18NALL: page prose moved into rich() must still reach the docs.
const KNOWN_TAGS = new Set(['b', 'strong', 'i', 'em', 'code', 'a', 'span', 'sub', 'sup', 'abbr', 'kbd', 'small', 'mark', 'br']);
export function richToProse(s) {
  // the English may be several literals joined by +, as a long message is split over lines
  const head = new RegExp(String.raw`\{\s*rich\(\s*${STR}\s*,\s*(${STR}(?:\s*\+\s*${STR})*)`, 'g');
  let out = '';
  let at = 0;
  for (let m; (m = head.exec(s)); ) {
    let i = m.index + m[0].length;
    const argsFrom = i;
    let depth = 1;
    let q = null;
    for (; i < s.length && depth > 0; i++) {
      const c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const close = s.slice(i).match(/^\s*\}/);
    if (depth || !close) continue;
    // a value that is an element holding plain text, or a plain string, is written in (`name: <code>x</code>`); others drop
    const args = s.slice(argsFrom, i - 1);
    const vals = {};
    const wrap = { code: '`', b: '**', strong: '**', i: '*', em: '*' };
    for (const v of args.matchAll(new RegExp(String.raw`(\w+)\s*:\s*(?:<([a-z]+)\b[^>]*>(?:\{\s*(${STR})\s*\}|([^<{]*))</\2>|(${STR}))`, 'g'))) {
      const w = wrap[v[2]] ?? '';
      vals[v[1]] ??= v[2] ? w + (v[3] != null ? unq(v[3]) : v[4]) + w : unq(v[5]);
    }
    // a page helper that makes a code chip from (key, text), as What.jsx's inline('softness', 'softness')
    for (const v of args.matchAll(new RegExp(String.raw`(\w+)\s*:\s*\w+\(\s*${STR}\s*,\s*(${STR})\s*\)`, 'g'))) vals[v[1]] ??= '`' + unq(v[2]) + '`';
    const joined = joinLits(m[1]);
    const en = joined
      .replace(/\{(\w+)\}/g, (all, k) => vals[k] ?? all)
      .replace(/<([A-Za-z][\w-]*)>([\s\S]*?)<\/\1>/g, (all, tag, inner) => (KNOWN_TAGS.has(tag) ? all : inner));
    out += s.slice(at, m.index) + en;
    at = i + close[0].length;
    head.lastIndex = at;
  }
  return out + s.slice(at);
}

export function jsxProse(src) {
  // whole-line // comments first: a block-comment opener written inside a // comment (What.jsx names src/how/*.settle)
  // would otherwise pair with a later */ and swallow everything between
  let s = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  s = richToProse(s);
  s = s.replace(new RegExp(String.raw`=\{\s*${T_CALL.source}\s*\}`, 'g'), (_, l) => `=${JSON.stringify(joinLits(l))}`);
  s = s.replace(new RegExp(String.raw`\{\s*${T_CALL.source}\s*\}`, 'g'), (_, l) => joinLits(l));
  const out = [];
  const re = /<Section\b([^>]*)>|<(h[1-4]|p|blockquote)\b[^>]*>([\s\S]*?)<\/\2>/g;
  for (const m of s.matchAll(re)) {
    if (m[1] != null) {
      const attr = (n) => (m[1].match(new RegExp(String.raw`\b${n}=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`)) || [])[1];
      const label = attr('label') && unq(attr('label'));
      const title = attr('title') && unq(attr('title'));
      if (label || title) out.push(`## ${[title, label && `(${label})`].filter(Boolean).join(' ')}`);
      continue;
    }
    const inner = cleanInner(m[3]);
    // a block whose words were all expressions leaves only punctuation ("PART ·"); skip it
    if (!inner || inner.length < 3 || /(^|\s)[·:]\s*$|^[·:]/.test(inner)) continue;
    if (m[2].startsWith('h')) out.push(`### ${inner}`);
    else if (m[2] === 'blockquote') out.push(`> ${inner}`);
    else out.push(inner);
  }
  return out.join('\n\n');
}

// ── glossary readers ────────────────────────────────────────────────────────────────────────────
const clean = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim();

export function statementRows(md, family, src) {
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*\[`([^`]+)`\]\([^)]*\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (m) rows.push({ term: m[1], kind: 'SETTLE statement', family, block: m[2], definition: clean(m[3]), source: src });
  }
  return rows;
}

export function familyRows(md, src) {
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*\d+\s*\|\s*\[([a-z0-9]+)\]\([^)]*\)\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/);
    if (m) rows.push({ term: m[1], kind: 'SETTLE family', definition: clean(m[3]), source: src, detail: m[2] });
  }
  return rows;
}

export function tokenRows(md, src) {
  const rows = [];
  let inTable = false;
  for (const line of md.split('\n')) {
    if (/^\|\s*Token\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && !line.startsWith('|')) inTable = false;
    if (!inTable || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length >= 2) rows.push({ term: cells[0].toLowerCase(), kind: 'SETTLE token', definition: `${clean(cells[1])}${cells[2] ? `, as in ${cells[2].replace(/`/g, '')}` : ''}`, source: src });
  }
  return rows;
}

export function proseBlocks(md) {
  const blocks = [];
  let cur = null;
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      cur = null;
      continue;
    }
    if (fence || /^\s*(\||#)/.test(line) || !line.trim()) {
      cur = null;
      continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+/.test(line);
    if (item || !cur) {
      cur = { item, text: line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim() };
      blocks.push(cur);
    } else cur.text += ' ' + line.trim();
  }
  return blocks;
}

const sentences = (t) => t.split(/(?<=[.!?])\s+(?=[A-Z`*])/);

// a bold word defines itself in the sentence that introduces it
export function boldDefinitions(md, src, kind) {
  const rows = [];
  for (const b of proseBlocks(md)) {
    for (const s of sentences(b.text)) {
      for (const m of s.matchAll(/\*\*([^*`\n]{2,40})\*\*/g)) {
        const term = m[1].trim().toLowerCase();
        if (/[.:!?,]$/.test(m[1].trim()) || term.split(/\s+/).length > 4) continue;
        if (/^(note|warning|licence|the repository)/.test(term)) continue;
        rows.push({ term, kind, definition: clean(s).replace(/`/g, ''), source: src });
      }
    }
  }
  return rows;
}

export function moduleRows(md, src) {
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (m) rows.push({ term: m[1], kind: 'KANERVA module', definition: clean(m[2]), source: src, detail: clean(m[3]) });
  }
  return rows;
}

// KANERVA_TERMS.md renames the SDM words: the first column is the term; a column headed old, was, before, previous or
// replaces is kept as an alias; the last other column is the meaning
export function termsTables(md, src) {
  const rows = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|') || !/^\|\s*:?-/.test(lines[i + 1] || '')) continue;
    const head = lines[i].split('|').slice(1, -1).map((c) => c.trim().toLowerCase());
    const oldCol = head.findIndex((h) => /\b(old|was|before|previous|replaces)\b/.test(h));
    const newCol = head.findIndex((h) => /\b(new|now|term|kanerva)\b/.test(h) && !/\b(old|was|before|previous)\b/.test(h));
    const termCol = newCol >= 0 ? newCol : oldCol === 0 ? 1 : 0;
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
      const cells = lines[j].split('|').slice(1, -1).map((c) => c.trim());
      const term = clean(cells[termCol] || '').replace(/`/g, '');
      if (!term) continue;
      const alias = oldCol >= 0 && oldCol !== termCol ? clean(cells[oldCol] || '').replace(/`/g, '') : '';
      const used = new Set([termCol, oldCol]);
      const def = cells.filter((_, k) => !used.has(k)).map(clean).filter(Boolean).pop() || '';
      rows.push({ term, kind: 'KANERVA term', definition: def, source: src, ...(alias ? { aliases: [alias] } : {}) });
    }
    i += 1;
  }
  return rows;
}

// the site's own vocabulary table (i18n/GLOSSARY.md: | English | Japanese | note |): the English word and its note
export function vocabularyRows(md, src) {
  const rows = [];
  for (const line of md.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0]) || cells[0] === 'English' || !cells[2]) continue;
    rows.push({ term: cells[0], kind: 'site word', definition: cells[2].replace(/;.*$/, '').trim(), source: src });
  }
  return rows;
}

function dedupe(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.kind}::${r.term.toLowerCase()}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()].sort((a, b) => a.term.localeCompare(b.term) || a.kind.localeCompare(b.kind));
}

// ── markdown writers ────────────────────────────────────────────────────────────────────────────
const GEN = (from) => `<!-- GENERATED by tools/build_mcp_docs.mjs from ${from}. Do not edit: change the site and rebuild. -->\n\n`;
const fence = (code, lang = '') => `\`\`\`${lang}\n${code}\n\`\`\``;
const sectionMd = (s, level = '##') => [`${level} ${s.h}`, '', ...s.paras.flatMap((p) => [p, '']), ...(s.code ? [fence(s.code, s.lang), ''] : [])].join('\n');

// one agent's install guide: where it keeps servers, how, the command or config, the other form, the page it came from
export const agentMd = (a, level = '###') =>
  [`${level} ${a.name}`, '', `Where: ${a.where}.`, '', ...a.how.flatMap((h) => [h, '']), ...(a.install ? [`One-click install (${{ cursor: 'Add to Cursor', vscode: 'Install in VS Code' }[a.install.kind]}), the agent's documented link format (${a.install.format}):`, '', fence(a.install.href, 'text'), ''] : []), fence(a.code, a.lang), '', ...(a.also ? ['Or the same entry by hand:', '', fence(a.also, a.alsoLang), ''] : []), `Source: ${a.source}`, ''].join('\n');

const toolLine = (t) => `- \`${t.name}\`: ${t.description}${t.example ? `\n  Example: \`${t.example.replace(/\n/g, '\\n')}\`` : ''}`;

export function readmeMd(D, sdk, pkg) {
  const O = D.oneCommand;
  return [
    GEN('SETTLE/settle-site/src/data/mcpDocs.js'),
    `# ${D.name}`,
    '',
    D.line,
    '',
    `## ${O.h}`,
    '',
    fence(O.code, O.lang),
    '',
    ...O.paras.flatMap((p) => [p, '']),
    '| when | the server command | |',
    '|---|---|---|',
    ...O.states.map((st) => `| ${st.when} | \`${st.code}\` | ${st.note} |`),
    '',
    '## What it needs',
    '',
    ...D.needs.map((n) => `- ${n}`),
    '',
    `Built on \`@modelcontextprotocol/sdk\` ${sdk} over standard input and output (stdio). Version ${pkg.version}. ${D.support.licence}`,
    '',
    '## Get it going in your agent',
    '',
    `Every agent below starts the same server: the command \`npx\` with the arguments \`-y --allow-git=root github:triplesparkle/settle-mcp\`. From a clone, use the command \`node\` with the path of \`src/bin.js\` instead. The agents come in this order: ${D.agents.map((a) => a.name).join(', ')}.`,
    '',
    ...D.agents.map((a) => agentMd(a)),
    '## The tools, in three parts',
    '',
    ...D.parts.flatMap((p) => [`### PART ${['ONE', 'TWO', 'THREE'][p.n - 1]} · ${p.title}`, '', p.line, '', ...D.tools.filter((t) => t.part === p.n).map(toolLine), '']),
    '## Resources',
    '',
    ...D.resources.map((r) => `- \`${r.uri}\`: ${r.what}`),
    '',
    '## Prompts',
    '',
    ...D.prompts.map((p) => `- \`${p.name}\`: ${p.description}`),
    '',
    '## Setting SETTLE up: a dry run, then confirm',
    '',
    ...D.setup.filter((x) => /plan|setup does/i.test(x.h)).flatMap((x) => [`### ${x.h}`, '', ...x.paras.flatMap((q) => [q, ''])]),
    '## From scratch',
    '',
    ...D.walkthrough.map((st, i) => sectionMd({ ...st, h: `${i + 1}. ${st.h}` }, '###')),
    '## What it never does',
    '',
    ...D.never.map((n) => `- ${n}`),
    '',
    '## Licence',
    '',
    D.support.licence,
    '',
    '## Problems',
    '',
    D.support.issues,
    '',
    '## More',
    '',
    `> ${D.rule}`,
    '',
    '- `docs/INSTALL.md`: the install guide for every agent, the same as above.',
    '- `docs/SETUP.md`: setting SETTLE and KANERVA up.',
    '- `docs/USAGE.md`: the usage tools, `.kanerva` programs, error carets, the Rails builder and calibrated refusal.',
    '- `docs/GLOSSARY.md`: every name, with the doc it comes from.',
    '- `AGENTS.md`: the main agent document: who you are, what this is, where each reader starts, the tools, the docs.',
    '- `docs/who-you-are/`: the three guides, one per reader (programmers, visual artists, sound artists), from the site.',
    '- `docs/site/`: the site pages these docs are built from, as text.',
    '- `CHANGELOG.md`: what each version changed.',
    '- `RELEASE_CHECKLIST.md` (in the repository, not in the npm package): what was checked for a release and what is still to decide.',
    '- `npm run build-docs` rebuilds everything from the site; `npm test` runs the tests.',
    '',
  ].join('\n');
}

export function installMd(D) {
  const O = D.oneCommand;
  return [
    GEN('SETTLE/settle-site/src/data/mcpDocs.js (oneCommand, agents)'),
    '# Installing settle-mcp in your agent',
    '',
    fence(O.code, O.lang),
    '',
    ...O.paras.flatMap((p) => [p, '']),
    ...O.states.map((st) => `- ${st.when}: \`${st.code}\`. ${st.note}`),
    '',
    ...D.agents.map((a) => agentMd(a, '##')),
  ].join('\n');
}

// the kanerva command's own programs (kanerva/programs/<name>.kanerva and its recorded .out) as documents
export function kanervaProgramDocs(files) {
  const by = new Map(files.map((f) => [f.path.split('/').pop(), f]));
  return [...by.keys()]
    .filter((n) => n.endsWith('.kanerva'))
    .map((n) => {
      const name = n.replace(/\.kanerva$/, '');
      const prog = by.get(n);
      const out = by.get(`${name}.out`);
      const text = [`# ${n}`, '', `A program for the kanerva command: \`kanerva programs/${n}\` (or \`run_kanerva {"program": "${name}"}\`).`, '', '```settle', prog.text.trimEnd(), '```', '', ...(out ? [`Its recorded output, \`programs/${name}.out\`:`, '', '```', out.text.trimEnd(), '```', ''] : [])].join('\n');
      return { uri: `kanerva://programs/${name}`, name: `kanerva-programs/${name}`, title: `KANERVA program ${n}`, path: prog.path, text };
    });
}

function glossaryMd(entries) {
  const kinds = [...new Set(entries.map((e) => e.kind))];
  return kinds
    .map((k) => [`## ${k}`, '', ...entries.filter((e) => e.kind === k).map((e) => `- **${e.term}**${e.aliases?.length ? ` (was: ${e.aliases.join(', ')})` : ''}: ${e.definition} _(${e.source})_`), ''].join('\n'))
    .join('\n');
}

function stringsMd(json) {
  const cat = JSON.parse(json);
  const groups = {};
  for (const [id, en] of Object.entries(cat)) (groups[id.split('.')[0]] ||= []).push([id, en]);
  return Object.entries(groups)
    .map(([g, rows]) => [`## ${g}`, '', ...rows.map(([id, en]) => `- \`${id}\`: ${String(en).replace(/<\/?[a-z]+>/g, '').replace(/\s+/g, ' ')}`), ''].join('\n'))
    .join('\n');
}

// ── AGENTS.md: the main agent document (lane WHOYOUARE, 2026-10-02) ─────────────────────────────
// The MCP convention is the server's `instructions` field, handed to every client at initialize; the estate's is an
// AGENTS.md at the package root. settle-mcp carries both from one source: AGENTS.md is generated here from the site
// (the three WHO YOU ARE guides, the MCP's own words, the docs list) and is served as the resource settle-mcp://agents;
// instructionsText is the short form the server declares at initialize. Neither is edited by hand.
const ORD = ['ONE', 'TWO', 'THREE'];
const firstParagraph = (md) => {
  const lines = String(md).split('\n');
  let i = 0;
  while (i < lines.length && (/^#/.test(lines[i]) || !lines[i].trim())) i++;
  const out = [];
  while (i < lines.length && lines[i].trim()) out.push(lines[i++].trim());
  return out.join(' ');
};
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const readerOf = (folder) => ({ 'for-programmers': 'a programmer or computer scientist', 'for-visual-artists': 'a visual artist', 'for-sound-artists': 'a sound artist' })[folder] ?? folder;

export function agentsMd(D, who, docs, examples, gloss) {
  const byPart = (n) => D.tools.filter((t) => t.part === n).map((t) => `- \`${t.name}\`: ${t.description}`);
  return [
    GEN('SETTLE/settle-site/docs/who-you-are and SETTLE/settle-site/src/data/mcpDocs.js'),
    '# AGENTS.md: settle-mcp, for the assistant reading this',
    '',
    `You are connected to ${D.name}: ${lowerFirst(D.line)} Read this document first, then the guide for the person you are helping, then call tools.`,
    '',
    '## If you are installing it rather than using it',
    '',
    `Add it to the agent you run in with one command, \`${D.oneCommand.code}\`, or the config for your agent in \`docs/INSTALL.md\` (${D.agents.map((a) => a.name).join(', ')}). ${D.needs[0]}`,
    '',
    '## Who you are helping',
    '',
    'Three kinds of reader come here, and each has a guide written in their own terms: what this is, how to use it in a project (SETTLE alone, the KANERVA memory alone, the two together), one real example with its real output, a getting-started, and links into the detailed docs. Find out which reader you have and read that guide before anything else; `read_doc` takes the name, and each is a resource.',
    '',
    ...who.map((g) => `- ${readerOf(g.folder)}: \`read_doc {"name": "${g.name}"}\` or the resource \`${g.uri}\`. ${firstParagraph(g.text)}`),
    '',
    'The folder index is `site://who-you-are`. When the reader is none of the three, start with the programmer guide and say so.',
    '',
    '## What this is',
    '',
    '- SETTLE is a small language for settling machines: name yes-or-no things, give them leans and pulls, hold what you know, let the machine settle, and ask it questions. The interpreter is settle-rs, a Rust binary.',
    '- KANERVA is the Rust crate for sparse distributed memory SETTLE uses: write long bit patterns, read one back from a noisy read-address, refuse one that was never stored.',
    `- ${D.name} is this server. ${D.rule}`,
    '',
    '## Where each reader starts',
    '',
    '- A programmer: `help` with a topic, `list_examples`, `get_example`, then `check_system` and `setup` (a dry run until confirmed), then `run_program` and `sdm_store_recall`, then `run_kanerva` with `{"program": "sdm"}` to run KANERVA alone.',
    '- A visual artist: the guide first; then `sdm_store_recall` with their own patterns, and `run_program` on the picture program in the guide. The drawing library, settle-see, is a folder of plain JavaScript named in the guide.',
    '- A sound artist: the guide first; then `run_program` on a model that chooses a chord voicing by annealing. The hearing library, settle-hear, and its voices table are named in the guide.',
    '',
    '## The tools, in three parts',
    '',
    ...D.parts.flatMap((p) => [`### PART ${ORD[p.n - 1]} · ${p.title}`, '', p.line, '', ...byPart(p.n), '']),
    '## The docs',
    '',
    `- ${docs.length} documents as resources: the three guides and their index (\`site://who-you-are/...\`), the SETTLE docs (\`settle://docs/...\`, \`settle://readme\`), the KANERVA README (\`kanerva://readme\`${docs.some((d) => d.uri === 'kanerva://terms') ? ' and `kanerva://terms`' : ''}), and the site pages (\`site://...\`). \`read_doc\` with no name lists them.`,
    `- ${examples.length} tested example programs as \`settle://examples/{name}\`; \`list_examples\` and \`get_example\` read them.`,
    `- ${docs.filter((d) => d.uri.startsWith('kanerva://programs/')).length} programs for the kanerva command as \`kanerva://programs/{name}\` (${docs.filter((d) => d.uri.startsWith('kanerva://programs/')).map((d) => d.uri.split('/').pop()).join(', ')}), each with its recorded output; \`run_kanerva\` runs them.`,
    `- The glossary of ${gloss.length} names as \`settle-mcp://glossary\`; \`help\` with a topic looks one up.`,
    '- `settle-mcp://help` (the three parts and where to start), `settle-mcp://usage`, `settle-mcp://setup`, and this document as `settle-mcp://agents`.',
    '- Prompts: `explain-settling`, `write-settle-program`, `sdm-store-recall`.',
    '',
    '## The rules',
    '',
    '- `setup` is a dry run until you pass `dry_run` false with the plan id it returned as `confirm`, so the person sees every command before anything runs. It never uses sudo.',
    '- Nothing is published to npm. The repositories are public, under github.com/triplesparkle: never invent another URL. For setup, use the folder or git URL the person gives you.',
    '- When a program fails, hand `explain_error` the whole printed error: the `settle: line N:` line and the excerpt and caret lines under it. It names the marked word and the suggested fix.',
    '- `.kanerva` programs hold only the sdm family and run on the kanerva command (`run_kanerva`); `via: :pulls` is the one read only SETTLE runs.',
    '- Quote a number with the document or the program output it came from; the guides name their sources.',
    '- The website is the source of truth: these files are generated from the SETTLE site, and a change belongs there.',
    '',
  ].join('\n');
}

export function instructionsText(D, who) {
  const guides = who.map((g) => `${g.uri} (${readerOf(g.folder)})`).join(', ');
  return `${D.name}: ${lowerFirst(D.line)} Read the resource settle-mcp://agents (AGENTS.md) first, then the guide for the person you are helping: ${guides}. Then help with a topic, list_examples and get_example, check_system, setup (a dry run until you pass dry_run false with the plan id it returned as confirm), run_program and sdm_store_recall.`;
}

// ── THE SITE FOR AGENTS (lane MCPREADY, 2026-10-06; the navigator: "make the site good for AGENTS too, so an AI agent can
// just be pointed at the site and get going"). The site is a single-page app, so an agent that fetches it reads no words.
// This build also writes, into the site's public/ folder: /llms.txt (llmstxt.org: an H1, a summary, H2 lists of links
// to Markdown), /llms-full.txt (every doc in one file, Mintlify's convention), /llms/** (a Markdown mirror of every doc
// the MCP serves, by path) and /robots.txt (everyone allowed, pointing at /llms.txt). They are generated here, from the
// same inputs, so they can never drift from the MCP's docs; the site's tests fail while they are stale.
export const SITE_PUBLIC = `${SITE}/public`;
const WHAT_THIS_IS = [
  'SETTLE is a small language for settling machines: name yes-or-no things, give them leans and pulls, hold what you know, let the machine settle, and ask it questions. The interpreter is settle-rs, a Rust binary.',
  'KANERVA is the Rust crate for sparse distributed memory SETTLE uses: write long bit patterns, read one back from a noisy read-address, refuse one that was never stored. Its `kanerva` command runs `.kanerva` programs on KANERVA alone.',
];
export function llmsPath(uri) {
  const [scheme, rest] = uri.split('://');
  if (scheme === 'site') return rest === 'who-you-are' ? 'llms/who-you-are/README.md' : rest.startsWith('who-you-are/') ? `llms/${rest}.md` : `llms/site/${rest}.md`;
  if (scheme === 'settle') return rest === 'readme' ? 'llms/settle/README.md' : `llms/settle/${rest}`;
  if (scheme === 'kanerva') return rest === 'readme' ? 'llms/kanerva/README.md' : rest === 'terms' ? 'llms/kanerva/KANERVA_TERMS.md' : `llms/kanerva/${rest}.md`;
  return null;
}
const MCP_MIRROR = [
  ['README.md', 'README.md', 'what settle-mcp is, the one command, every agent, the tools with an example each'],
  ['docs/INSTALL.md', 'INSTALL.md', 'the install guide for each agent: Hermes, Claude Code, Claude Desktop, Codex, Cursor and the rest'],
  ['AGENTS.md', 'AGENTS.md', 'the document an assistant reads first: who it is helping, the tools, the rules'],
  ['docs/SETUP.md', 'SETUP.md', 'building SETTLE and KANERVA on a machine: a dry run, then confirm'],
  ['docs/USAGE.md', 'USAGE.md', 'running programs, .kanerva programs, error carets, the Rails builder, calibrated refusal'],
];

export function siteAgentFiles(D, files, docs) {
  const out = {};
  const pub = (rel) => `${SITE_PUBLIC}/${rel}`;
  const mirrored = docs.filter((d) => d.uri !== 'site://strings' && llmsPath(d.uri));
  for (const [from, to] of MCP_MIRROR) out[pub(`llms/settle-mcp/${to}`)] = files[from];
  for (const d of mirrored) out[pub(llmsPath(d.uri))] = d.text.endsWith('\n') ? d.text : `${d.text}\n`;
  const link = (rel, title, note) => `- [${title}](/${rel})${note ? `: ${note}` : ''}`;
  const group = (pred) => mirrored.filter(pred).map((d) => link(llmsPath(d.uri), d.title));
  out[pub('llms.txt')] = [
    '# SETTLE',
    '',
    `> ${WHAT_THIS_IS[0]} ${WHAT_THIS_IS[1]} ${D.name} is ${lowerFirst(D.line)}`,
    '',
    'This site is a single-page app, so its words for agents are here as Markdown, one file per document, generated from the same sources as the site and the MCP server. `/llms-full.txt` holds them all in one file.',
    '',
    `To give an assistant SETTLE and KANERVA as tools, add ${D.name} to it: \`${D.oneCommand.code}\`. ${D.oneCommand.paras[1]}`,
    '',
    `## ${D.name}`,
    '',
    ...MCP_MIRROR.map(([, to, note]) => link(`llms/settle-mcp/${to}`, to, note)),
    '',
    '## Who you are',
    '',
    ...group((d) => d.uri.startsWith('site://who-you-are')),
    '',
    '## SETTLE',
    '',
    ...group((d) => d.uri.startsWith('settle://')),
    '',
    '## KANERVA',
    '',
    ...group((d) => d.uri.startsWith('kanerva://')),
    '',
    '## Optional',
    '',
    ...group((d) => d.uri.startsWith('site://') && !d.uri.startsWith('site://who-you-are')),
    link('llms-full.txt', 'llms-full.txt', 'every document above, in one file'),
    '',
  ].join('\n');
  const full = [
    ['README.md', files['README.md']],
    ['docs/INSTALL.md', files['docs/INSTALL.md']],
    ['AGENTS.md', files['AGENTS.md']],
    ['docs/SETUP.md', files['docs/SETUP.md']],
    ['docs/USAGE.md', files['docs/USAGE.md']],
    ...mirrored.filter((d) => !d.uri.startsWith('site://') || d.uri.startsWith('site://who-you-are')).map((d) => [d.path, d.text]),
  ];
  out[pub('llms-full.txt')] = `# SETTLE: every document, in one file\n\n> ${WHAT_THIS_IS[0]} ${WHAT_THIS_IS[1]}\n\n${full.map(([src, t]) => `---\n\nSource: ${src}\n\n${t.trim()}\n`).join('\n')}`;
  out[pub('robots.txt')] = ['# SETTLE: people, crawlers and agents are all welcome. For agents, start at /llms.txt.', 'User-agent: *', 'Allow: /', ''].join('\n');
  // the same index at /.well-known/llms.txt, for agents that look there first (lane SITEPASS); its links are rooted at
  // the site, so they resolve from either address
  out[pub('.well-known/llms.txt')] = out[pub('llms.txt')];
  return out;
}

// ── the build ───────────────────────────────────────────────────────────────────────────────────
// the repository banner tool, imported from disk like the glossary; null in a standalone copy of the package
export async function loadBanner(root = repoRoot()) {
  const p = path.join(root, INPUTS.banner);
  if (!fs.existsSync(p)) return null;
  return import(pathToFileURL(p).href);
}

async function loadMcpDocs(src) {
  // the module is plain data; importing it from a data: URL lets an override (a test) change it in memory
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  return mod.MCP_DOCS;
}

// THE SITE'S INDEX OF TERMS (lane WTF, 2026-10-01): src/wtf/terms.js is the one record of every word on the site. It is
// a module (it derives docs anchors and imports two name constants), so it is imported from disk, never from an
// override; its extracted text (term, kind, meaning, usage, places, sources) is what the hash is over.
export async function loadWtf(root = repoRoot()) {
  const p = path.join(root, INPUTS.wtf);
  if (!fs.existsSync(p)) return null;
  const m = await import(pathToFileURL(p).href);
  const kinds = Object.fromEntries(m.KINDS.map((k) => [k.key, k.name]));
  const terms = m.TERMS.map((r) => ({ id: r.id, term: r.term, kind: kinds[r.kind], aliases: r.aliases, meaning: r.meaning, usage: r.usage, where: r.where, source: r.source.map((x) => x.path ?? x.url), ja: r.ja }));
  return { kinds: m.KINDS.map((k) => ({ key: k.key, name: k.name, line: k.line })), terms };
}

export function wtfRows(w) {
  return w.terms.map((r) => ({ term: r.term, kind: `site index: ${r.kind}`, definition: r.meaning, source: `${INPUTS.wtf} (#/glossary#${r.id})` }));
}

export function wtfMd(w) {
  const out = ["Every word on the SETTLE site, what it means there, where it is used, and where it came from. The site's own page is the glossary, `#/glossary`; one record per term lives in `" + INPUTS.wtf + '`.', ''];
  for (const k of w.kinds) {
    const rows = w.terms.filter((r) => r.kind === k.name).sort((a, b) => a.term.localeCompare(b.term));
    out.push(`## ${k.name}`, '', k.line, '');
    for (const r of rows) {
      out.push(`### ${r.term}`, '', r.meaning, '', r.usage, '');
      if (r.aliases.length) out.push(`- also: ${r.aliases.join(', ')}`);
      if (r.ja && r.ja !== r.term) out.push(`- Japanese: ${r.ja}`);
      if (r.where.length) out.push(`- where: ${r.where.join(', ')}`);
      out.push(`- source: ${r.source.join(', ')}`, `- link: #/glossary#${r.id}`, '');
    }
  }
  return out.join('\n');
}

export async function buildAll({ root = repoRoot(), override = {} } = {}) {
  const I = readInputs(root, override);
  if (!I.mcpSrc || !I.settleDocs.length) return null;
  const W = await loadWtf(root);
  const D = await loadMcpDocs(I.mcpSrc);
  // the banner decorates a repository's front page; the READMEs served to agents go without it
  const B = await loadBanner(root);
  if (B) {
    if (I.settleReadme) I.settleReadme = B.stripBanner(I.settleReadme);
    if (I.kanervaReadme) I.kanervaReadme = B.stripBanner(I.kanervaReadme);
  }
  const bannerBlock = B ? B.bannerFor('settle-mcp') : null;
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  const sdk = pkgJson.dependencies['@modelcontextprotocol/sdk'];

  // what each input contributes, the thing the hash is over
  const pages = I.pages.map((p) => ({ ...p, prose: jsxProse(p.text) }));
  const contrib = [
    { path: INPUTS.mcp, text: JSON.stringify(D) },
    ...(I.strings ? [{ path: INPUTS.strings, text: I.strings }] : []),
    ...(I.vocabulary ? [{ path: INPUTS.vocabulary, text: I.vocabulary }] : []),
    ...pages.map((p) => ({ path: p.path, text: p.prose })),
    ...I.settleDocs,
    ...I.examples,
    ...(I.settleReadme ? [{ path: INPUTS.settleReadme, text: I.settleReadme }] : []),
    ...(I.kanervaReadme ? [{ path: INPUTS.kanervaReadme, text: I.kanervaReadme }] : []),
    ...(I.kanervaTerms ? [{ path: INPUTS.kanervaTerms, text: I.kanervaTerms }] : []),
    ...I.kanervaPrograms,
    ...(W ? [{ path: INPUTS.wtf, text: JSON.stringify(W) }] : []),
    ...(I.whoYouAre.index ? [{ path: `${INPUTS.whoYouAre}/README.md`, text: I.whoYouAre.index }] : []),
    ...I.whoYouAre.guides,
    ...(bannerBlock ? [{ path: INPUTS.banner, text: bannerBlock }] : []),
  ];
  const inputs = contrib.map((c) => ({ path: c.path, sha256: sha(c.text) }));
  const hash = sha(JSON.stringify(inputs));

  // the docs the index serves
  const docName = (p) => p.replace(`${INPUTS.settleDocs}/`, '');
  const titleOf = (t, f) => (t.match(/^#\s+(.+)$/m) || [null, f])[1].trim();
  // WHO YOU ARE first: the guide for the person the assistant is helping is the first document a client should read
  const who = I.whoYouAre.guides.map((g) => ({ folder: g.folder, uri: `site://who-you-are/${g.folder}`, name: `who-you-are/${g.folder}`, title: `WHO YOU ARE: ${titleOf(g.text, g.folder)}`, path: g.path, text: g.text }));
  const docs = [
    ...(I.whoYouAre.index ? [{ uri: 'site://who-you-are', name: 'who-you-are', title: 'WHO YOU ARE: three guides, one per reader', path: `${INPUTS.whoYouAre}/README.md`, text: I.whoYouAre.index }] : []),
    ...who,
    ...(I.settleReadme ? [{ uri: 'settle://readme', name: 'README.md', title: 'SETTLE README', path: INPUTS.settleReadme, text: I.settleReadme }] : []),
    ...I.settleDocs.map((d) => ({ uri: `settle://docs/${docName(d.path)}`, name: docName(d.path), title: titleOf(d.text, docName(d.path)), path: d.path, text: d.text })),
    ...(I.kanervaReadme ? [{ uri: 'kanerva://readme', name: 'README.md', title: 'KANERVA README', path: INPUTS.kanervaReadme, text: I.kanervaReadme }] : []),
    ...(I.kanervaTerms ? [{ uri: 'kanerva://terms', name: 'KANERVA_TERMS.md', title: 'KANERVA terms', path: INPUTS.kanervaTerms, text: I.kanervaTerms }] : []),
    ...kanervaProgramDocs(I.kanervaPrograms),
    ...pages.map((p) => ({ uri: `site://${p.key}`, name: p.key, title: `Site: ${p.title}`, path: p.path, text: `# ${p.title}\n\n${p.prose}` })),
    ...(I.strings ? [{ uri: 'site://strings', name: 'strings', title: "Site: every English string (the i18n catalogue)", path: INPUTS.strings, text: `# The site's English strings\n\n${stringsMd(I.strings)}` }] : []),
    ...(W ? [{ uri: 'site://glossary', name: 'glossary', title: 'Site: the glossary, the index of every term', path: INPUTS.wtf, text: `# glossary\n\n${wtfMd(W)}` }] : []),
  ];

  const byName = new Map(I.examples.map((e) => [e.path.split('/').pop(), e.text]));
  const examples = [...byName.keys()]
    .filter((f) => f.endsWith('.settle'))
    .map((f) => {
      const name = f.replace(/\.settle$/, '');
      const source = byName.get(f);
      const err = byName.get(`${name}.err`) ?? null;
      return { name, title: (source.match(/^#\s*(.+)$/m) || [null, ''])[1].trim(), source, kind: err != null ? 'error' : 'ok', out: byName.get(`${name}.out`) ?? null, err };
    });

  const glossary = [];
  for (const d of I.settleDocs) {
    const n = docName(d.path);
    if (n === '05-statements/README.md') glossary.push(...familyRows(d.text, d.path));
    else if (n.startsWith('05-statements/')) glossary.push(...statementRows(d.text, n.replace(/^05-statements\/|\.md$/g, ''), d.path));
    if (n === '03-syntax.md') glossary.push(...tokenRows(d.text, d.path));
    if (!/CHANGELOG/.test(n)) glossary.push(...boldDefinitions(d.text, d.path, 'SETTLE word'));
  }
  if (I.kanervaReadme) glossary.push(...moduleRows(I.kanervaReadme, INPUTS.kanervaReadme), ...boldDefinitions(I.kanervaReadme, INPUTS.kanervaReadme, 'KANERVA word'));
  if (I.kanervaTerms) glossary.push(...termsTables(I.kanervaTerms, INPUTS.kanervaTerms));
  if (I.vocabulary) glossary.push(...vocabularyRows(I.vocabulary, INPUTS.vocabulary));
  for (const p of pages) glossary.push(...boldDefinitions(p.prose, p.path, 'site word'));
  glossary.push(...D.tools.map((t) => ({ term: t.name, kind: 'settle-mcp tool', definition: t.description, source: INPUTS.mcp })));
  if (W) glossary.push(...wtfRows(W));
  const gloss = dedupe(glossary);

  const agents = agentsMd(D, who, docs, examples, gloss);
  const content = { hash, mcp: { name: D.name, line: D.line, rule: D.rule, parts: D.parts, tools: D.tools, instructions: instructionsText(D, who) }, docs, examples, glossary: gloss };
  const readme = readmeMd(D, sdk, pkgJson);
  const files = {
    'README.md': B ? B.withBanner(readme, 'settle-mcp', B.repoOf('settle-mcp').description) : readme,
    'docs/INSTALL.md': installMd(D),
    'AGENTS.md': agents,
    ...(I.whoYouAre.index ? { 'docs/who-you-are/README.md': `${GEN(`${INPUTS.whoYouAre}/README.md`)}${I.whoYouAre.index}` } : {}),
    ...Object.fromEntries(I.whoYouAre.guides.map((g) => [`docs/who-you-are/${g.folder}/README.md`, `${GEN(g.path)}${g.text}`])),
    'docs/SETUP.md': [GEN('SETTLE/settle-site/src/data/mcpDocs.js (setup)'), '# Setting SETTLE and KANERVA up', '', ...D.setup.map((s) => sectionMd(s))].join('\n'),
    'docs/USAGE.md': [GEN('SETTLE/settle-site/src/data/mcpDocs.js (usage)'), '# Using SETTLE and KANERVA through settle-mcp', '', ...D.usage.map((s) => sectionMd(s))].join('\n'),
    'docs/GLOSSARY.md': `${GEN('the site and the docs it shows')}# Glossary (${gloss.length} names)\n\n${glossaryMd(gloss)}`,
    ...Object.fromEntries(pages.map((p) => [`docs/site/${p.key}.md`, `${GEN(p.path)}# ${p.title}\n\n${p.prose}\n`])),
    ...(I.strings ? { 'docs/site/strings.md': `${GEN(INPUTS.strings)}# The site's English strings\n\n${stringsMd(I.strings)}` } : {}),
    ...(W ? { 'docs/site/glossary.md': `${GEN(INPUTS.wtf)}# glossary\n\n${wtfMd(W)}\n` } : {}),
    'content/docs.json': JSON.stringify(content, null, 1) + '\n',
    'content/inputs.json': JSON.stringify({ hash, inputs }, null, 1) + '\n',
  };
  // the site's agent mirrors carry the README without its banner, like the SETTLE and KANERVA READMEs above
  const siteFiles = siteAgentFiles(D, { ...files, 'README.md': readme }, docs);
  return { files, siteFiles, root, hash, inputs };
}

export async function inputsHash(opts) {
  const b = await buildAll(opts);
  return b ? b.hash : null;
}

export function storedHash() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG, 'content', 'inputs.json'), 'utf8')).hash;
  } catch {
    return null;
  }
}

export function writeAll(build) {
  const keep = new Set(Object.keys(build.files));
  const siteDir = path.join(PKG, 'docs', 'site');
  if (fs.existsSync(siteDir)) for (const f of fs.readdirSync(siteDir)) if (!keep.has(`docs/site/${f}`)) fs.rmSync(path.join(siteDir, f));
  for (const [rel, text] of Object.entries(build.files)) {
    fs.mkdirSync(path.dirname(path.join(PKG, rel)), { recursive: true });
    fs.writeFileSync(path.join(PKG, rel), text);
  }
  // the site's agent files: a mirror file no longer generated is removed, one file at a time
  const root = build.root ?? repoRoot();
  const keepSite = new Set(Object.keys(build.siteFiles ?? {}));
  for (const f of walk(path.join(root, SITE_PUBLIC, 'llms'), () => true)) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (!keepSite.has(rel)) fs.rmSync(f);
  }
  for (const [rel, text] of Object.entries(build.siteFiles ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

// the paths of the generated files whose disk content differs from a fresh build ([] when fresh)
export async function staleFiles(opts) {
  const b = await buildAll(opts);
  if (!b) return [];
  const differs = (abs, text) => !fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== text;
  const pkgStale = Object.entries(b.files).filter(([rel, text]) => differs(path.join(PKG, rel), text)).map(([rel]) => rel);
  const siteStale = Object.entries(b.siteFiles).filter(([rel, text]) => differs(path.join(b.root, rel), text)).map(([rel]) => rel);
  // a mirror file on disk that the build no longer makes is stale too
  const extra = walk(path.join(b.root, SITE_PUBLIC, 'llms'), () => true).map((f) => path.relative(b.root, f).split(path.sep).join('/')).filter((rel) => !(rel in b.siteFiles));
  return [...pkgStale, ...siteStale, ...extra];
}

export async function ensureFresh(log = () => {}) {
  const b = await buildAll();
  if (!b) return { rebuilt: false, reason: 'no site beside this package; serving the committed docs' };
  if (b.hash === storedHash()) return { rebuilt: false, reason: 'fresh' };
  writeAll(b);
  log(`settle-mcp: the site content changed (inputs ${b.hash.slice(0, 12)}), rebuilt the docs`);
  return { rebuilt: true, hash: b.hash };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const b = await buildAll();
  if (!b) {
    console.log('build_mcp_docs: no SETTLE site beside this package; keeping the committed docs');
    process.exit(0);
  }
  if (process.argv.includes('--check')) {
    const stale = await staleFiles();
    if (stale.length) {
      console.error(`build_mcp_docs: stale (${stale.join(', ')}); run node SETTLE/settle-mcp/tools/build_mcp_docs.mjs`);
      process.exit(1);
    }
    console.log(`build_mcp_docs: fresh (inputs ${b.hash.slice(0, 12)})`);
  } else {
    writeAll(b);
    const c = JSON.parse(b.files['content/docs.json']);
    console.log(`build_mcp_docs: ${Object.keys(b.files).length} files, ${c.docs.length} docs, ${c.examples.length} examples, ${c.glossary.length} glossary names, inputs ${b.hash.slice(0, 12)}`);
  }
}
