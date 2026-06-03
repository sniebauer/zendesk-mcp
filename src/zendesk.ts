import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import zendesk from "node-zendesk";

export interface ZendeskConfig {
  subdomain: string;
  email: string;
  token: string;
}

const CONFIG_PATH = path.join(os.homedir(), ".config", "zendesk-mcp", "config.json");

interface FileConfig {
  subdomain?: string;
  email?: string;
  api_token?: string;
}

function loadFileConfig(): FileConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as FileConfig;
  } catch {
    return {};
  }
}

export function loadConfig(): ZendeskConfig {
  const file = loadFileConfig();
  const subdomain = process.env.ZENDESK_SUBDOMAIN || file.subdomain;
  const email = process.env.ZENDESK_EMAIL || file.email;
  const token = process.env.ZENDESK_API_TOKEN || file.api_token;
  if (!subdomain || !email || !token) {
    throw new Error(
      `Missing Zendesk credentials. Run 'npx -y @sniebauer/zendesk-mcp setup' to configure interactively, or set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN in your environment.`
    );
  }
  return { subdomain, email, token };
}

export function createZendeskClient(cfg = loadConfig()) {
  return zendesk.createClient({
    username: cfg.email,
    token: cfg.token,
    subdomain: cfg.subdomain,
    endpointUri: `https://${cfg.subdomain}.zendesk.com/api/v2`,
  });
}

export interface ParsedZendeskError {
  status: number | undefined;
  message: string;
  retryAfterSec: number | undefined;
}

export class ZendeskMcpError extends Error {
  override name = "ZendeskMcpError";
  status: number | undefined;
  constructor(parsed: ParsedZendeskError) {
    super(parsed.message);
    this.status = parsed.status;
  }
}

export function parseZendeskError(err: unknown): ParsedZendeskError {
  const e = err as any;
  const status: number | undefined = e?.statusCode ?? e?.status;
  const retryAfterRaw = e?.headers?.["retry-after"];
  const retryAfterSec =
    retryAfterRaw === undefined ? undefined : Number.parseInt(String(retryAfterRaw), 10);

  if (status === 401 || status === 403) {
    return {
      status,
      message: `${status} ${e?.result?.error ?? "Unauthorized"}: check ZENDESK_API_TOKEN and ZENDESK_EMAIL in .env`,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    };
  }

  const errorName = e?.result?.error;
  const description = e?.result?.description;
  if (status && errorName) {
    const tail = description ? `: ${description}` : "";
    return {
      status,
      message: `${status} ${errorName}${tail}`,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    };
  }

  return {
    status,
    message: e?.message ?? String(err),
    retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
  };
}

export async function withZendeskError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const parsed = parseZendeskError(err);
    if (parsed.status === 429) {
      const waitMs = (parsed.retryAfterSec ?? 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      try {
        return await fn();
      } catch (err2) {
        throw new ZendeskMcpError(parseZendeskError(err2));
      }
    }
    throw new ZendeskMcpError(parsed);
  }
}
