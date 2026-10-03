#!/usr/bin/env node
// bin.js - start the SETTLE MCP server on standard input and output (the stdio transport). Logs go to standard
// error only, because standard output carries the protocol. Before it starts, the docs are checked against the
// SETTLE site they are built from and rebuilt if the site changed (tools/build_mcp_docs.mjs, ensureFresh).

import { ensureFresh } from '../tools/build_mcp_docs.mjs';

if (!process.env.SETTLE_MCP_NO_REBUILD) {
  try {
    await ensureFresh((m) => console.error(m));
  } catch (e) {
    console.error(`settle-mcp: could not check the docs against the site (${e.message}); serving the committed docs`);
  }
}

const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { createServer, SERVER_VERSION, SDK_VERSION } = await import('./server.js');

if (process.argv.includes('--version')) {
  console.log(`settle-mcp ${SERVER_VERSION} (@modelcontextprotocol/sdk ${SDK_VERSION})`);
  process.exit(0);
}

const server = createServer();
await server.connect(new StdioServerTransport());
console.error(`settle-mcp ${SERVER_VERSION} on stdio (@modelcontextprotocol/sdk ${SDK_VERSION})`);
