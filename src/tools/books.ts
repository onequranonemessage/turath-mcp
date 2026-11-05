import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { API_URL, FILES_URL, getJson, getCatalog, parseMeta, resolvePdfUrls, stripHtml } from "../client.js";
import { ok, guard } from "./util.js";

interface BookMeta {
  id: number;
  name: string;
  type?: number;
  printed?: number;
  pdf_links?: { root: string; files: string[] };
  info?: string;
  [k: string]: unknown;
}
interface Heading {
  title: string;
  level: number;
  page: number;
}
interface BookIndexes {
  volumes?: string[];
  headings?: Heading[];
  [k: string]: unknown;
}
interface BookV3Page {
  text: string;
  vol?: string | number;
  page?: number;
}
interface BookV3 {
  pages: BookV3Page[];
  [k: string]: unknown;
}

async function enrich(bookId: number) {
  const catalog = await getCatalog().catch(() => null);
  const cb = catalog?.books[String(bookId)];
  const author = cb ? (catalog?.authors[String(cb.author_id)]?.name ?? null) : null;
  const category = cb ? (catalog?.cats[String(cb.cat_id)]?.name ?? null) : null;
  return { cb, author, category };
}

export function registerBookTools(server: McpServer): void {
  server.registerTool(
    "turath_get_book",
    {
      title: "Turath: book metadata",
      description:
        "Get full metadata for one book: title, author, category, page count, PDF availability + " +
        "download links, and the publisher `info` block (muhaqqiq, publisher, edition, etc.). Provide " +
        "the book id (from search hits, `turath_find_books`, or `turath_browse_category`).",
      inputSchema: { book_id: z.number().int().describe("Book id.") },
    },
    ({ book_id }) =>
      guard(async () => {
        const resp = await getJson<{ meta: BookMeta }>(
          `${API_URL}/book?${new URLSearchParams({ id: String(book_id), include: "meta", ver: "3" })}`,
        );
        const meta = resp.meta ?? ({} as BookMeta);
        const { cb, author, category } = await enrich(book_id);
        const pdf_urls = resolvePdfUrls(meta.pdf_links);
        return ok({
          id: meta.id ?? book_id,
          name: meta.name ?? cb?.name ?? null,
          author_id: cb?.author_id ?? null,
          author,
          cat_id: cb?.cat_id ?? null,
          category,
          page_count: cb?.page_count ?? null,
          has_pdf: cb?.has_pdf ?? pdf_urls.length > 0,
          pdf_urls,
          info: meta.info ?? null,
        });
      }),
  );

  server.registerTool(
    "turath_get_book_toc",
    {
      title: "Turath: book table of contents",
      description:
        "Get a book's table of contents (headings) and volume list. Each heading has a title, nesting " +
        "level, and the page it starts on. Use the page numbers with `turath_get_page`.",
      inputSchema: {
        book_id: z.number().int().describe("Book id."),
        max_headings: z.number().int().min(1).optional().describe("Cap the number of headings returned."),
      },
    },
    ({ book_id, max_headings }) =>
      guard(async () => {
        const resp = await getJson<{ meta: BookMeta; indexes: BookIndexes }>(
          `${API_URL}/book?${new URLSearchParams({ id: String(book_id), include: "indexes", ver: "3" })}`,
        );
        const idx = resp.indexes ?? {};
        let headings = idx.headings ?? [];
        const total = headings.length;
        if (max_headings) headings = headings.slice(0, max_headings);
        return ok({
          book_id,
          name: resp.meta?.name ?? null,
          volumes: idx.volumes ?? null,
          heading_count: total,
          headings,
        });
      }),
  );

  server.registerTool(
    "turath_get_page",
    {
      title: "Turath: single page text",
      description:
        "Fetch the text of a single page by its sequential page index (`pg`, 1-based across the whole " +
        "book). Returns the page text plus metadata (printed page number, volume, section headings).",
      inputSchema: {
        book_id: z.number().int().describe("Book id."),
        pg: z.number().int().min(1).describe("1-based sequential page index within the book."),
        raw_html: z.boolean().optional().describe("Keep inline markup instead of stripping (default false)."),
      },
    },
    ({ book_id, pg, raw_html }) =>
      guard(async () => {
        const resp = await getJson<{ text: string; meta: string }>(
          `${API_URL}/page?${new URLSearchParams({ book_id: String(book_id), pg: String(pg), ver: "3" })}`,
        );
        const meta = parseMeta(resp.meta) ?? {};
        return ok({
          book_id,
          pg,
          printed_page: meta.page ?? null,
          volume: meta.vol ?? null,
          headings: meta.headings ?? null,
          book_name: meta.book_name ?? null,
          author_name: meta.author_name ?? null,
          text: raw_html ? resp.text : stripHtml(resp.text),
        });
      }),
  );

  server.registerTool(
    "turath_get_book_text",
    {
      title: "Turath: full book text (page range)",
      description:
        "Fetch the plain text of a book, all pages or a range, in one call (downloads the book's bundled " +
        "text file). Each returned page has its sequential index, printed page number, volume, and text. " +
        "For large books, always pass `from_pg`/`to_pg` (sequential indices) to stay within output limits.",
      inputSchema: {
        book_id: z.number().int().describe("Book id."),
        from_pg: z.number().int().min(1).optional().describe("First sequential page index (default 1)."),
        to_pg: z.number().int().min(1).optional().describe("Last sequential page index (inclusive)."),
        max_pages: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Safety cap on pages returned in one call (default 50)."),
        raw_html: z.boolean().optional().describe("Keep inline markup instead of stripping (default false)."),
      },
    },
    ({ book_id, from_pg, to_pg, max_pages, raw_html }) =>
      guard(async () => {
        const book = await getJson<BookV3>(`${FILES_URL}/books-v3/${book_id}.json`);
        const pages = book.pages ?? [];
        const total = pages.length;
        const start = (from_pg ?? 1) - 1;
        const cap = max_pages ?? 50;
        const endExclusive = Math.min(to_pg != null ? to_pg : start + cap, total, start + cap);
        const out = [];
        for (let i = Math.max(0, start); i < endExclusive; i++) {
          const p = pages[i]!;
          out.push({
            pg: i + 1,
            printed_page: p.page ?? null,
            volume: p.vol ?? null,
            text: raw_html ? p.text : stripHtml(p.text),
          });
        }
        return ok({
          book_id,
          total_pages: total,
          from_pg: start + 1,
          to_pg: endExclusive,
          returned: out.length,
          truncated: endExclusive < (to_pg ?? total) && out.length >= cap,
          pages: out,
        });
      }),
  );
}
