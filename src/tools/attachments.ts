import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../zendesk.js";

export const getTicketAttachmentInput = z.object({
  url: z
    .string()
    .url()
    .describe(
      "The full content_url of a Zendesk attachment (find it in the attachments[] array of a comment returned by zd_get_ticket). Must point to the configured Zendesk subdomain."
    ),
});

function basicAuthHeader(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64");
}

function assertAttachmentHost(url: URL, subdomain: string): void {
  const expected = `${subdomain}.zendesk.com`;
  if (url.hostname !== expected) {
    throw new Error(
      `Attachment URL host '${url.hostname}' does not match configured Zendesk subdomain '${expected}'. Refusing to send credentials to a different host.`
    );
  }
}

export function registerAttachmentTools(server: McpServer) {
  server.tool(
    "zd_get_ticket_attachment",
    "Fetch a Zendesk ticket attachment by URL using the authenticated session. Pass the `content_url` from a comment's attachments array (call zd_get_ticket first). For images, returns a native image content block so Claude can see the image directly. For other file types, returns base64-encoded bytes with content_type and size metadata. The URL must point to the configured Zendesk subdomain.",
    getTicketAttachmentInput.shape,
    async (raw) => {
      const { url } = getTicketAttachmentInput.parse(raw);
      const cfg = loadConfig();
      const parsed = new URL(url);
      assertAttachmentHost(parsed, cfg.subdomain);

      const res = await fetch(url, {
        headers: { Authorization: basicAuthHeader(cfg.email, cfg.token) },
        redirect: "follow",
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const tail = body ? `: ${body.slice(0, 200)}` : "";
        throw new Error(`${res.status} ${res.statusText} for ${url}${tail}`);
      }

      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const buf = Buffer.from(await res.arrayBuffer());
      const base64 = buf.toString("base64");

      if (contentType.startsWith("image/")) {
        return {
          content: [
            { type: "image", data: base64, mimeType: contentType },
            {
              type: "text",
              text: JSON.stringify(
                { content_type: contentType, size_bytes: buf.length },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { content_type: contentType, size_bytes: buf.length, base64 },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
