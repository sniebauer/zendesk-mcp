import TurndownService from "turndown";
import { loadConfig } from "./zendesk.js";

function helpCenterBase(): string {
  return `https://${loadConfig().subdomain}.zendesk.com/api/v2/help_center`;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html);
}

export class HelpCenterError extends Error {
  override name = "HelpCenterError";
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function hcFetch(path: string): Promise<unknown> {
  const url = `${helpCenterBase()}${path}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HelpCenterError(
      res.status,
      `${res.status} ${res.statusText} for ${url}${text ? `: ${text.slice(0, 200)}` : ""}`
    );
  }
  return res.json();
}

export interface HCArticleSearchHit {
  id: number;
  title: string;
  html_url: string;
  snippet: string;
}

export async function searchArticles(query: string, locale: string): Promise<HCArticleSearchHit[]> {
  const qs = new URLSearchParams({ query, locale, per_page: "25" });
  const data = (await hcFetch(`/articles/search.json?${qs.toString()}`)) as {
    results: Array<{ id: number; title: string; html_url: string; snippet?: string }>;
  };
  return (data.results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    html_url: r.html_url,
    snippet: r.snippet ?? "",
  }));
}

export interface HCArticle {
  id: number;
  title: string;
  html_url: string;
  section_id: number | null;
  updated_at: string;
  body_html: string;
  body_markdown: string;
}

export async function getArticle(id: number, locale: string): Promise<HCArticle> {
  const data = (await hcFetch(`/${locale}/articles/${id}.json`)) as {
    article: {
      id: number;
      title: string;
      html_url: string;
      section_id: number | null;
      updated_at: string;
      body: string;
    };
  };
  const a = data.article;
  return {
    id: a.id,
    title: a.title,
    html_url: a.html_url,
    section_id: a.section_id,
    updated_at: a.updated_at,
    body_html: a.body ?? "",
    body_markdown: htmlToMarkdown(a.body ?? ""),
  };
}

export interface HCSection {
  id: number;
  name: string;
  description: string;
  category_id: number;
  html_url: string;
}

export async function listSections(locale: string): Promise<HCSection[]> {
  const data = (await hcFetch(`/${locale}/sections.json?per_page=100`)) as {
    sections: HCSection[];
  };
  return data.sections ?? [];
}
