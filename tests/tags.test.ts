import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ACTIONED_TAG,
  REVIEWED_TAG,
  appendTag,
  stampTag,
} from "../src/tags.js";

const cfg = { subdomain: "acme", email: "agent@acme.com", token: "tok123" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tag constants", () => {
  it("uses 'ai_actioned' for writes", () => {
    expect(ACTIONED_TAG).toBe("ai_actioned");
  });

  it("uses 'ai_reviewed' for reads", () => {
    expect(REVIEWED_TAG).toBe("ai_reviewed");
  });
});

describe("stampTag", () => {
  it("PUTs to the additive tags endpoint with only the tag to add", async () => {
    // node-zendesk's client.tickets.addTags routes the PUT through requestAll(),
    // which drops the body and silently no-ops. So we hit the raw additive
    // endpoint (PUT /tickets/{id}/tags.json) ourselves.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await stampTag(cfg, 275807, ACTIONED_TAG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://acme.zendesk.com/api/v2/tickets/275807/tags.json");
    expect(opts.method).toBe("PUT");
    // Additive endpoint: body carries ONLY the tag to add; existing tags are
    // preserved server-side. A full `tags` replace would be the bug we avoid.
    expect(JSON.parse(String(opts.body))).toEqual({ tags: [ACTIONED_TAG] });
    expect((opts.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /
    );
  });

  it("stamps whichever tag it is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await stampTag(cfg, 42, REVIEWED_TAG);

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toEqual({ tags: [REVIEWED_TAG] });
  });

  it("is best-effort: a network error never throws to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(stampTag(cfg, 7, ACTIONED_TAG)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("is best-effort: a non-2xx response is logged, not thrown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(stampTag(cfg, 7, REVIEWED_TAG)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("appendTag", () => {
  // Used by zd_create_ticket, which can carry the tag inline in the create
  // payload — no second API call and no extra audit entry on a brand-new ticket.
  it("adds the tag when the caller passed no tags", () => {
    expect(appendTag(undefined, ACTIONED_TAG)).toEqual([ACTIONED_TAG]);
  });

  it("preserves caller-supplied tags", () => {
    expect(appendTag(["urgent", "billing"], ACTIONED_TAG)).toEqual([
      "urgent",
      "billing",
      ACTIONED_TAG,
    ]);
  });

  it("does not duplicate a tag the caller already supplied", () => {
    expect(appendTag(["urgent", ACTIONED_TAG], ACTIONED_TAG)).toEqual([
      "urgent",
      ACTIONED_TAG,
    ]);
  });
});
