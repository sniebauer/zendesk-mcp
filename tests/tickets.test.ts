import { describe, it, expect, vi, afterEach } from "vitest";
import { ACTIONED_TAG, stampActioned } from "../src/tools/tickets.js";

const cfg = { subdomain: "acme", email: "agent@acme.com", token: "tok123" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("stampActioned", () => {
  it("uses the tag value 'ai_actioned'", () => {
    expect(ACTIONED_TAG).toBe("ai_actioned");
  });

  it("PUTs to the additive tags endpoint with only the tag to add (append, not replace)", async () => {
    // node-zendesk's client.tickets.addTags routes the PUT through requestAll(),
    // which drops the body and silently no-ops. So stampActioned must hit the
    // raw additive endpoint (PUT /tickets/{id}/tags.json) itself.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await stampActioned(cfg, 275807);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://acme.zendesk.com/api/v2/tickets/275807/tags.json"
    );
    expect(opts.method).toBe("PUT");
    // Additive endpoint: body carries ONLY the tag(s) to add; existing tags are
    // preserved server-side. A full `tags` replace would be the bug we avoid.
    expect(JSON.parse(String(opts.body))).toEqual({ tags: [ACTIONED_TAG] });
    expect((opts.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /
    );
  });

  it("is best-effort: a network error never throws to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(stampActioned(cfg, 7)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("is best-effort: a non-2xx response is logged, not thrown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(stampActioned(cfg, 7)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
