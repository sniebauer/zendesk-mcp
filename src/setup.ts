import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "zendesk-mcp");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

interface StoredConfig {
  subdomain: string;
  email: string;
  api_token: string;
}

async function loadExisting(): Promise<Partial<StoredConfig>> {
  try {
    const text = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(text) as StoredConfig;
  } catch {
    return {};
  }
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

export async function runSetup(): Promise<void> {
  console.log("Zendesk MCP — setup\n");
  console.log("This will write credentials to " + CONFIG_PATH + " (mode 0600).");
  console.log("Get a Zendesk API token at:");
  console.log("  https://<your-subdomain>.zendesk.com/admin/apps-integrations/apis/zendesk-api\n");

  const existing = await loadExisting();
  const rl = createInterface({ input, output });

  try {
    const subdomain = await prompt(rl, "Zendesk subdomain", existing.subdomain);
    const email = await prompt(rl, "Your Zendesk email", existing.email);
    const api_token = await prompt(rl, "API token", existing.api_token ? "(unchanged)" : undefined);

    if (!subdomain || !email) {
      console.error("\nsubdomain and email are required. Aborting.");
      process.exit(1);
    }

    const finalToken = api_token === "(unchanged)" ? existing.api_token : api_token;
    if (!finalToken) {
      console.error("\nAPI token is required. Aborting.");
      process.exit(1);
    }

    await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const config: StoredConfig = { subdomain, email, api_token: finalToken };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    // chmod again in case the file already existed with a different mode
    await fs.chmod(CONFIG_PATH, 0o600);

    console.log(`\nWrote ${CONFIG_PATH}`);
    console.log("\nNow add this to your Claude Desktop config (or `~/.claude.json` for Claude Code):\n");
    console.log(JSON.stringify({
      mcpServers: {
        zendesk: {
          command: "npx",
          args: ["-y", "@sniebauer/zendesk-mcp"],
        },
      },
    }, null, 2));
    console.log("\nClaude Desktop config lives at:");
    console.log("  macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json");
    console.log("  Windows: %APPDATA%\\\\Claude\\\\claude_desktop_config.json");
    console.log("\nThen restart Claude Desktop. The new tools appear under the 'zendesk' MCP.");
  } finally {
    rl.close();
  }
}
