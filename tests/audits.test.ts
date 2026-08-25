import { describe, it, expect } from "vitest";
import {
  NOISE_EVENT_TYPES,
  collectAuthorIds,
  describeVia,
  diffList,
  hasCustomFieldChanges,
  summarizeAudits,
  type RawAudit,
} from "../src/audits.js";

const TAGS_BEFORE = ["alpha", "beta", "gamma"];
const TAGS_AFTER = ["alpha", "gamma", "delta"];

describe("diffList", () => {
  it("reduces a before/after tag list to just the delta", () => {
    expect(diffList(TAGS_BEFORE, TAGS_AFTER)).toEqual({
      added: ["delta"],
      removed: ["beta"],
    });
  });

  it("treats a space-delimited string as a list", () => {
    expect(diffList("alpha beta", "alpha gamma")).toEqual({
      added: ["gamma"],
      removed: ["beta"],
    });
  });

  it("handles null/undefined on either side", () => {
    expect(diffList(null, ["a"])).toEqual({ added: ["a"], removed: [] });
    expect(diffList(["a"], undefined)).toEqual({ added: [], removed: ["a"] });
  });
});

describe("describeVia", () => {
  it("names the rule when a trigger or automation drove the change", () => {
    expect(
      describeVia({
        channel: "rule",
        source: { rel: "trigger", from: { title: "Assign to Support", id: 1 } },
      })
    ).toBe("trigger: Assign to Support");
  });

  it("falls back to the bare channel for direct agent action", () => {
    expect(describeVia({ channel: "web", source: { rel: null, from: {} } })).toBe("web");
    expect(describeVia(undefined)).toBe("unknown");
  });
});

describe("summarizeAudits", () => {
  it("summarizes a status change with actor and mechanism", () => {
    const audits: RawAudit[] = [
      {
        id: 9,
        created_at: "2026-08-19T14:02:00Z",
        author_id: 402665568794,
        via: { channel: "web", source: { rel: null } },
        events: [
          { id: 1, type: "Change", field_name: "status", previous_value: "open", value: "pending" },
        ],
      },
    ];
    const [event] = summarizeAudits(audits, {
      resolveActor: (id) => (id === 402665568794 ? "Steve Niebauer" : undefined),
    });
    expect(event).toEqual({
      at: "2026-08-19T14:02:00Z",
      actor: "Steve Niebauer",
      via: "web",
      audit_id: 9,
      kind: "change",
      field: "status",
      from: "open",
      to: "pending",
    });
  });

  it("diffs tag changes instead of echoing the whole list twice", () => {
    const audits: RawAudit[] = [
      {
        id: 10,
        author_id: -1,
        events: [
          {
            type: "Change",
            field_name: "tags",
            previous_value: TAGS_BEFORE,
            value: TAGS_AFTER,
          },
        ],
      },
    ];
    const [event] = summarizeAudits(audits);
    expect(event.added).toEqual(["delta"]);
    expect(event.removed).toEqual(["beta"]);
    // The full before/after lists must not survive into the summary.
    expect(event.from).toBeUndefined();
    expect(event.to).toBeUndefined();
  });

  it("maps author_id -1 to 'system'", () => {
    const [event] = summarizeAudits([
      { author_id: -1, events: [{ type: "Change", field_name: "status", value: "closed" }] },
    ]);
    expect(event.actor).toBe("system");
  });

  it("falls back to the raw author id when the name cannot be resolved", () => {
    const [event] = summarizeAudits([
      { author_id: 777, events: [{ type: "Change", field_name: "status", value: "open" }] },
    ]);
    expect(event.actor).toBe("777");
  });

  it("resolves numeric custom field ids to titles but keeps the id", () => {
    const [event] = summarizeAudits(
      [
        {
          author_id: 1,
          events: [
            { type: "Change", field_name: "8315335133079", previous_value: "a", value: "b" },
          ],
        },
      ],
      { resolveField: (id) => (id === 8315335133079 ? "Ticket Bucket" : undefined) }
    );
    expect(event.field).toBe("Ticket Bucket");
    expect(event.field_id).toBe(8315335133079);
  });

  it("keeps the numeric id as the field name when resolution fails", () => {
    const [event] = summarizeAudits([
      { author_id: 1, events: [{ type: "Change", field_name: "12345", value: "b" }] },
    ]);
    expect(event.field).toBe("12345");
    expect(event.field_id).toBe(12345);
  });

  it("drops notification and webhook noise", () => {
    const audits: RawAudit[] = [
      {
        author_id: 1,
        events: [
          { type: "Notification", body: "<huge html email>", subject: "x" },
          { type: "FollowerNotification", body: "<another huge html email>" },
          { type: "WebhookEvent" },
          { type: "External", body: "{}" },
          { type: "Change", field_name: "priority", previous_value: "normal", value: "high" },
        ],
      },
    ];
    const events = summarizeAudits(audits);
    expect(events).toHaveLength(1);
    expect(events[0].field).toBe("priority");
    expect(JSON.stringify(events)).not.toContain("huge html email");
  });

  it("reduces comments to body-less stubs that point back at the full text", () => {
    const [event] = summarizeAudits([
      {
        author_id: 5,
        events: [
          {
            id: 4242,
            type: "Comment",
            public: true,
            body: "the entire comment body",
            html_body: "<p>the entire comment body</p>",
          },
        ],
      },
    ]);
    expect(event.kind).toBe("comment");
    expect(event.comment_id).toBe(4242);
    expect(event.public).toBe(true);
    expect(JSON.stringify(event)).not.toContain("entire comment body");
  });

  it("collapses per-field Create events into one 'created' entry that leads the audit", () => {
    const events = summarizeAudits([
      {
        author_id: 5,
        created_at: "2026-08-01T00:00:00Z",
        events: [
          { type: "Create", field_name: "subject", value: "Help me" },
          { type: "Create", field_name: "status", value: "new" },
          { id: 1, type: "Comment", public: true, body: "first message" },
        ],
      },
    ]);
    expect(events.map((e) => e.kind)).toEqual(["created", "comment"]);
    expect(events[0].values).toEqual({ subject: "Help me", status: "new" });
  });

  it("summarizes macro, CC and follower events", () => {
    const events = summarizeAudits([
      {
        author_id: 5,
        events: [
          { type: "AgentMacroReference", macro_title: "Quick response", macro_id: "1" },
          {
            type: "EmailCcChange",
            previous_email_ccs: ["a@x.com"],
            current_email_ccs: ["a@x.com", "b@x.com"],
          },
          {
            type: "FollowerChange",
            previous_followers: ["c@x.com"],
            current_followers: [],
          },
        ],
      },
    ]);
    expect(events[0]).toMatchObject({ kind: "macro_applied", macro: "Quick response" });
    expect(events[1]).toMatchObject({ kind: "cc_change", added: ["b@x.com"], removed: [] });
    expect(events[2]).toMatchObject({ kind: "follower_change", added: [], removed: ["c@x.com"] });
  });

  it("emits unrecognized event types as bare stubs rather than dropping them", () => {
    const [event] = summarizeAudits([
      { author_id: 5, events: [{ type: "SomeBrandNewZendeskEvent", body: "payload" }] },
    ]);
    expect(event.kind).toBe("SomeBrandNewZendeskEvent");
    expect(JSON.stringify(event)).not.toContain("payload");
  });

  it("prefers the event's own via over the audit's when a trigger fired it", () => {
    const [event] = summarizeAudits([
      {
        author_id: -1,
        via: { channel: "web" },
        events: [
          {
            type: "Change",
            field_name: "group_id",
            value: "26593617",
            via: { channel: "rule", source: { rel: "trigger", from: { title: "Route to Support" } } },
          },
        ],
      },
    ]);
    expect(event.via).toBe("trigger: Route to Support");
  });

  it("tolerates missing/empty audits and events", () => {
    expect(summarizeAudits([])).toEqual([]);
    expect(summarizeAudits([{ author_id: 1 }])).toEqual([]);
    expect(summarizeAudits([{ author_id: 1, events: null }])).toEqual([]);
  });
});

describe("lookup helpers", () => {
  it("collects distinct resolvable author ids, skipping the system id", () => {
    expect(
      collectAuthorIds([
        { author_id: 5 },
        { author_id: 5 },
        { author_id: -1 },
        { author_id: 9 },
      ])
    ).toEqual([5, 9]);
  });

  it("detects when a ticket-fields lookup is worth making", () => {
    expect(
      hasCustomFieldChanges([
        { events: [{ type: "Change", field_name: "status" }] },
      ])
    ).toBe(false);
    expect(
      hasCustomFieldChanges([
        { events: [{ type: "Change", field_name: "360022855394" }] },
      ])
    ).toBe(true);
  });
});

describe("NOISE_EVENT_TYPES", () => {
  it("covers the notification-shaped types that carry full email bodies", () => {
    for (const type of ["Notification", "FollowerNotification", "WebhookEvent", "External"]) {
      expect(NOISE_EVENT_TYPES.has(type)).toBe(true);
    }
  });

  it("does not suppress types that describe real ticket changes", () => {
    for (const type of ["Change", "Comment", "Create", "AgentMacroReference", "EmailCcChange"]) {
      expect(NOISE_EVENT_TYPES.has(type)).toBe(false);
    }
  });
});
