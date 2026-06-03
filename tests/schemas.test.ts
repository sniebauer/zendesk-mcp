import { describe, it, expect } from "vitest";
import { searchInput } from "../src/tools/search.js";
import {
  getTicketInput,
  createTicketInput,
  updateTicketInput,
  addTicketCommentInput,
} from "../src/tools/tickets.js";
import {
  getUserInput,
  searchUsersInput,
  createUserInput,
  updateUserInput,
} from "../src/tools/users.js";
import {
  getOrgInput,
  searchOrgsInput,
  createOrgInput,
  updateOrgInput,
} from "../src/tools/orgs.js";
import {
  listViewTicketsInput,
  incrementalTicketsInput,
} from "../src/tools/reporting.js";
import {
  hcSearchInput,
  hcGetArticleInput,
  hcListSectionsInput,
} from "../src/tools/help-center.js";
import {
  listMacrosInput,
  searchMacrosInput,
  getMacroInput,
  applyMacroToTicketInput,
} from "../src/tools/macros.js";
import { getTicketAttachmentInput } from "../src/tools/attachments.js";

describe("zd_search input schema", () => {
  it("requires a non-empty query string", () => {
    expect(() => searchInput.parse({ query: "" })).toThrow();
    expect(() => searchInput.parse({})).toThrow();
    expect(searchInput.parse({ query: "type:ticket status:open" })).toEqual({
      query: "type:ticket status:open",
    });
  });
});

describe("ticket schemas", () => {
  it("zd_get_ticket requires a positive integer id", () => {
    expect(() => getTicketInput.parse({ id: 0 })).toThrow();
    expect(() => getTicketInput.parse({ id: -5 })).toThrow();
    expect(() => getTicketInput.parse({ id: "abc" })).toThrow();
    expect(getTicketInput.parse({ id: 12345 })).toEqual({ id: 12345 });
  });

  it("zd_create_ticket requires subject and body", () => {
    expect(() => createTicketInput.parse({ subject: "x" })).toThrow();
    expect(() => createTicketInput.parse({ body: "x" })).toThrow();
    expect(
      createTicketInput.parse({ subject: "Hi", body: "Help" })
    ).toMatchObject({ subject: "Hi", body: "Help" });
  });

  it("zd_update_ticket requires id + at least one mutable field", () => {
    expect(() => updateTicketInput.parse({ id: 1 })).toThrow();
    expect(updateTicketInput.parse({ id: 1, status: "open" })).toEqual({
      id: 1,
      status: "open",
    });
  });

  it("zd_add_ticket_comment defaults public=false", () => {
    expect(addTicketCommentInput.parse({ id: 1, body: "note" })).toEqual({
      id: 1,
      body: "note",
      public: false,
    });
  });
});

describe("user schemas", () => {
  it("zd_get_user requires positive integer id", () => {
    expect(() => getUserInput.parse({ id: 0 })).toThrow();
    expect(getUserInput.parse({ id: 7 })).toEqual({ id: 7 });
  });

  it("zd_search_users requires non-empty query", () => {
    expect(() => searchUsersInput.parse({ query: "" })).toThrow();
    expect(searchUsersInput.parse({ query: "email:foo@bar.com" })).toEqual({
      query: "email:foo@bar.com",
    });
  });

  it("zd_create_user requires name + email and validates role", () => {
    expect(() => createUserInput.parse({ name: "A" })).toThrow();
    expect(() => createUserInput.parse({ name: "A", email: "x" })).toThrow();
    expect(() =>
      createUserInput.parse({ name: "A", email: "a@b.com", role: "bogus" })
    ).toThrow();
    expect(
      createUserInput.parse({ name: "A", email: "a@b.com", role: "agent" })
    ).toEqual({ name: "A", email: "a@b.com", role: "agent" });
  });

  it("zd_update_user requires id + at least one mutable field", () => {
    expect(() => updateUserInput.parse({ id: 1 })).toThrow();
    expect(updateUserInput.parse({ id: 1, name: "B" })).toEqual({ id: 1, name: "B" });
  });
});

describe("org schemas", () => {
  it("zd_get_organization requires positive integer id", () => {
    expect(() => getOrgInput.parse({ id: -1 })).toThrow();
    expect(getOrgInput.parse({ id: 9 })).toEqual({ id: 9 });
  });

  it("zd_search_organizations requires non-empty name", () => {
    expect(() => searchOrgsInput.parse({ name: "" })).toThrow();
    expect(searchOrgsInput.parse({ name: "Acme" })).toEqual({ name: "Acme" });
  });

  it("zd_create_organization requires a name", () => {
    expect(() => createOrgInput.parse({})).toThrow();
    expect(createOrgInput.parse({ name: "Acme" })).toMatchObject({ name: "Acme" });
  });

  it("zd_update_organization requires id + at least one mutable field", () => {
    expect(() => updateOrgInput.parse({ id: 1 })).toThrow();
    expect(updateOrgInput.parse({ id: 1, name: "B" })).toEqual({ id: 1, name: "B" });
  });
});

describe("reporting schemas", () => {
  it("zd_list_view_tickets requires positive view_id", () => {
    expect(() => listViewTicketsInput.parse({ view_id: 0 })).toThrow();
    expect(listViewTicketsInput.parse({ view_id: 100 })).toEqual({ view_id: 100 });
  });

  it("zd_incremental_tickets requires Unix-seconds start_time", () => {
    expect(() => incrementalTicketsInput.parse({ start_time: -1 })).toThrow();
    expect(incrementalTicketsInput.parse({ start_time: 1700000000 })).toEqual({
      start_time: 1700000000,
    });
  });
});

describe("help center schemas", () => {
  it("zd_hc_search requires non-empty query, default locale en-us", () => {
    expect(() => hcSearchInput.parse({ query: "" })).toThrow();
    expect(hcSearchInput.parse({ query: "session replay" })).toEqual({
      query: "session replay",
      locale: "en-us",
    });
  });

  it("zd_hc_get_article requires positive integer id, default locale en-us", () => {
    expect(() => hcGetArticleInput.parse({ id: 0 })).toThrow();
    expect(hcGetArticleInput.parse({ id: 42 })).toEqual({ id: 42, locale: "en-us" });
  });

  it("zd_hc_list_sections default locale en-us", () => {
    expect(hcListSectionsInput.parse({})).toEqual({ locale: "en-us" });
  });
});

describe("macros schemas", () => {
  it("zd_list_macros accepts empty input", () => {
    expect(listMacrosInput.parse({})).toEqual({});
  });

  it("zd_search_macros requires a non-empty query", () => {
    expect(() => searchMacrosInput.parse({ query: "" })).toThrow();
    expect(searchMacrosInput.parse({ query: "reply" })).toEqual({ query: "reply" });
  });

  it("zd_get_macro requires positive integer id", () => {
    expect(() => getMacroInput.parse({ id: 0 })).toThrow();
    expect(getMacroInput.parse({ id: 42 })).toEqual({ id: 42 });
  });

  it("zd_apply_macro_to_ticket requires both ids positive", () => {
    expect(() => applyMacroToTicketInput.parse({ ticket_id: 0, macro_id: 1 })).toThrow();
    expect(() => applyMacroToTicketInput.parse({ ticket_id: 1, macro_id: 0 })).toThrow();
    expect(applyMacroToTicketInput.parse({ ticket_id: 100, macro_id: 200 })).toEqual({
      ticket_id: 100,
      macro_id: 200,
    });
  });
});

describe("attachment schemas", () => {
  it("zd_get_ticket_attachment requires a URL", () => {
    expect(() => getTicketAttachmentInput.parse({})).toThrow();
    expect(() => getTicketAttachmentInput.parse({ url: "" })).toThrow();
    expect(() => getTicketAttachmentInput.parse({ url: "not-a-url" })).toThrow();
    expect(
      getTicketAttachmentInput.parse({
        url: "https://acme.zendesk.com/attachments/token/abc/?name=x.png",
      })
    ).toEqual({
      url: "https://acme.zendesk.com/attachments/token/abc/?name=x.png",
    });
  });
});
