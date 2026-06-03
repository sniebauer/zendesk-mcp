import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../src/help-center.js";

describe("htmlToMarkdown", () => {
  it("converts basic headings, links, and paragraphs", () => {
    const html = `<h1>Title</h1><p>See <a href="https://example.com">docs</a>.</p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("[docs](https://example.com)");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});
