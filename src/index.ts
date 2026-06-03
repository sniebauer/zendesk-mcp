#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { runSetup } from "./setup.js";

async function main() {
  if (process.argv[2] === "setup") {
    await runSetup();
    return;
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("zendesk-mcp failed to start:", err);
  process.exit(1);
});
