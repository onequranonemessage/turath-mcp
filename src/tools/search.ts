import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { API_URL, getJson, getCatalog, parseMeta, stripHtml } from "../client.js";
import { ok, guard, toIdList } from "./util.js";

interface RawHit {
  book_id: number;
  cat_id: number;
  author_id: number;
  meta: string;
  snip: string;
  text: string;
}
interface SearchResponse {
  count: number;
  data: RawHit[];
}

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "turath_search",
    {
      title: "Turath: full-text search",
      description:
        "Full-text search across the entire Turath corpus (8500+ books, ~900M indexed words). Returns " +
        "the total match count and a page of 20 hits; each hit gives the book, author, category, page " +
        "number/volume, a highlighted snippet, and the surrounding page text. Filter by book, author, " +
        "or category, and page through results with `page`. This searches INSIDE book text — to find a " +
        "book by its title use `turath_find_books` instead.",
      inputSchema: {
        q: z.string().describe("Arabic search query. Multi-word queries match as a phrase (see precision)."),
        page: z.number().int().min(1).optional().describe("1-based results page; 20 hits per page (default 1)."),
        book_ids: z
          .union([z.array(z.number()), z.string()])
          .optional()
          .describe("Restrict to these book ids (array or comma-separated)."),
        author_ids: z
          .union([z.array(z.number()), z.string()])
          .optional()
          .describe("Restrict to these author ids."),
        cat_ids: z
          .union([z.array(z.number()), z.string()])
          .optional()
          .describe("Restrict to these category ids."),
        precision: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Max word gap allowed between phrase terms (default 2). Lower = stricter/closer."),
        stem: z
          .boolean()
          .optional()
          .describe("Arabic root/stem expansion (default true). Set false for exact word forms only."),
        include_footnotes: z
          .boolean()
          .optional()
          .describe(
            "Search non-author text too — footnotes, editor intros, margins (default true). " +
              "Set false to search only the main author text.",
          ),
        full_text: z
          .boolean()
          .optional()
          .describe("Include the full surrounding page text per hit (default false = snippet only)."),
        raw_html: z
          .boolean()
          .optional()
          .describe("Keep the inline <em>/<span> markup instead of stripping it (default false)."),
      },
    },
    (args) =>
      guard(async () => {
        const params = new URLSearchParams();
        params.set("ver", "3");
        params.set("q", args.q);
        if (args.page && args.page > 1) params.set("page", String(args.page));
        const books = toIdList(args.book_ids);
        const authors = toIdList(args.author_ids);
        const cats = toIdList(args.cat_ids);
        if (books.length) params.set("book", books.join(","));
        if (authors.length) params.set("author", authors.join(","));
        if (cats.length) params.set("cat", cats.join(","));
        if (args.precision != null) params.set("precision", String(args.precision));
        if (args.stem === false) params.set("stem", "0");
        if (args.include_footnotes === false) params.set("non_author", "0");

        const resp = await getJson<SearchResponse>(`${API_URL}/search?${params.toString()}`);
        const catalog = await getCatalog().catch(() => null);
        const rawHtml = args.raw_html ?? false;
        const full = args.full_text ?? false;

        const hits = (resp.data ?? []).map((h) => {
          const meta = parseMeta(h.meta) ?? {};
          const bookName =
            (meta.book_name as string) ?? catalog?.books[String(h.book_id)]?.name ?? null;
          const authorName =
            (meta.author_name as string) ?? catalog?.authors[String(h.author_id)]?.name ?? null;
          return {
            book_id: h.book_id,
            book_name: bookName,
            author_id: h.author_id,
            author_name: authorName,
            cat_id: h.cat_id,
            category: catalog?.cats[String(h.cat_id)]?.name ?? null,
            page: meta.page ?? null,
            page_id: meta.page_id ?? null,
            volume: meta.vol ?? null,
            headings: meta.headings ?? null,
            snippet: rawHtml ? h.snip : stripHtml(h.snip),
            ...(full ? { text: rawHtml ? h.text : stripHtml(h.text) } : {}),
          };
        });

        const perPage = 20;
        const pg = args.page ?? 1;
        return ok({
          query: args.q,
          total_count: resp.count,
          page: pg,
          per_page: perPage,
          has_more: resp.count > pg * perPage,
          returned: hits.length,
          hits,
        });
      }),
  );
}
