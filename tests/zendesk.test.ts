import { describe, it, expect } from "vitest";
import { withZendeskError, parseZendeskError } from "../src/zendesk.js";

describe("parseZendeskError", () => {
  it("extracts status and message from a node-zendesk error", () => {
    const err = { statusCode: 404, result: { error: "RecordNotFound", description: "Not found" } };
    expect(parseZendeskError(err)).toEqual({
      status: 404,
      message: "404 RecordNotFound: Not found",
      retryAfterSec: undefined,
    });
  });

  it("flags 401 with a token hint", () => {
    const err = { statusCode: 401, result: { error: "Couldn't authenticate you" } };
    const parsed = parseZendeskError(err);
    expect(parsed.status).toBe(401);
    expect(parsed.message).toMatch(/ZENDESK_API_TOKEN/);
  });

  it("reads Retry-After on 429", () => {
    const err = { statusCode: 429, result: {}, headers: { "retry-after": "3" } };
    expect(parseZendeskError(err).retryAfterSec).toBe(3);
  });

  it("falls back to message on unknown shapes", () => {
    const err = new Error("boom");
    expect(parseZendeskError(err).message).toBe("boom");
  });
});

describe("withZendeskError", () => {
  it("returns the underlying result on success", async () => {
    const result = await withZendeskError(async () => ({ id: 1 }));
    expect(result).toEqual({ id: 1 });
  });

  it("retries once on 429 then succeeds", async () => {
    let calls = 0;
    const result = await withZendeskError(async () => {
      calls += 1;
      if (calls === 1) {
        throw { statusCode: 429, result: {}, headers: { "retry-after": "0" } };
      }
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("throws a ZendeskMcpError on a second 429", async () => {
    await expect(
      withZendeskError(async () => {
        throw { statusCode: 429, result: {}, headers: { "retry-after": "0" } };
      })
    ).rejects.toMatchObject({ name: "ZendeskMcpError", status: 429 });
  });
});
