import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getCatalog,
  getJson,
  API_URL,
  normalizeArabic,
  type BookCatalogEntry,
} from "../client.js";
import { ok, guard } from "./util.js";

function bookView(b: BookCatalogEntry, cat: string, author: string) {
  return {
    id: b.id,
    name: b.name,
    author_id: b.author_id,
    author,
    cat_id: b.cat_id,
    category: cat,
    has_pdf: b.has_pdf,
    page_count: b.page_count ?? null,
  };
}

export function registerCatalogTools(server: McpServer): void {
  server.registerTool(
    "turath_stats",
    {
      title: "Turath: catalog statistics",
      description:
        "Return high-level statistics about the Turath library catalog: version, date, and the " +
        "number of books, authors, and categories. Use this to confirm connectivity and see how " +
        "large the corpus is.",
      inputSchema: { refresh: z.boolean().optional().describe("Force re-download of the catalog cache.") },
    },
    ({ refresh }) =>
      guard(async () => {
        const c = await getCatalog(refresh ?? false);
        return ok({
          version: c.version,
          date: c.date,
          books: Object.keys(c.books).length,
          authors: Object.keys(c.authors).length,
          categories: Object.keys(c.cats).length,
        });
      }),
  );

  server.registerTool(
    "turath_list_categories",
    {
      title: "Turath: list categories",
      description:
        "List every subject category (تصنيف) in the library, each with its id, Arabic name, and the " +
        "number of books it contains. Use category ids with `turath_browse_category` or as the " +
        "`cat_ids` filter in `turath_search`.",
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const c = await getCatalog();
        const cats = Object.values(c.cats)
          .map((cat) => ({ id: cat.id, name: cat.name, book_count: cat.books.length }))
          .sort((a, b) => a.id - b.id);
        return ok({ count: cats.length, categories: cats });
      }),
  );

  server.registerTool(
    "turath_browse_category",
    {
      title: "Turath: browse a category",
      description:
        "List the books in a single category, paginated. Returns each book's id, title, author, " +
        "category, PDF availability, and page count.",
      inputSchema: {
        cat_id: z.number().int().describe("Category id (see turath_list_categories)."),
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        page_size: z.number().int().min(1).max(500).optional().describe("Items per page (default 50)."),
      },
    },
    ({ cat_id, page, page_size }) =>
      guard(async () => {
        const c = await getCatalog();
        const cat = c.cats[String(cat_id)];
        if (!cat) throw new Error(`Unknown category id ${cat_id}.`);
        const size = page_size ?? 50;
        const pg = page ?? 1;
        const start = (pg - 1) * size;
        const slice = cat.books.slice(start, start + size);
        const books = slice.map((bid) => {
          const b = c.books[String(bid)];
          if (!b) return { id: bid, name: "(unknown)", author: "", category: cat.name };
          const author = c.authors[String(b.author_id)]?.name ?? "";
          return bookView(b, cat.name, author);
        });
        return ok({
          category: { id: cat.id, name: cat.name, total_books: cat.books.length },
          page: pg,
          page_size: size,
          returned: books.length,
          books,
        });
      }),
  );

  server.registerTool(
    "turath_find_books",
    {
      title: "Turath: find books by title",
      description:
        "Search the catalog by book TITLE (diacritic-insensitive, matches any/all query words). This " +
        "finds a book by name — it does NOT search inside book text; for that use `turath_search`. " +
        "Returns matching books with ids you can pass to the book/page/text tools.",
      inputSchema: {
        query: z.string().describe("Part of a book title, in Arabic (diacritics optional)."),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 30)."),
        match_all: z
          .boolean()
          .optional()
          .describe("Require all query words to appear (default true). If false, any word matches."),
      },
    },
    ({ query, limit, match_all }) =>
      guard(async () => {
        const c = await getCatalog();
        const words = normalizeArabic(query).split(" ").filter(Boolean);
        const all = match_all ?? true;
        const results: Array<ReturnType<typeof bookView>> = [];
        for (const b of Object.values(c.books)) {
          const hay = normalizeArabic(b.name);
          const hit = all ? words.every((w) => hay.includes(w)) : words.some((w) => hay.includes(w));
          if (hit) {
            const author = c.authors[String(b.author_id)]?.name ?? "";
            const cat = c.cats[String(b.cat_id)]?.name ?? "";
            results.push(bookView(b, cat, author));
          }
        }
        return ok({ query, total_matches: results.length, results: results.slice(0, limit ?? 30) });
      }),
  );

  server.registerTool(
    "turath_find_authors",
    {
      title: "Turath: find authors by name",
      description:
        "Search the catalog by AUTHOR name (diacritic-insensitive). Returns matching authors with id, " +
        "name, death year (Hijri), and how many books they have. Use author ids with `turath_get_author` " +
        "or as the `author_ids` filter in `turath_search`.",
      inputSchema: {
        query: z.string().describe("Part of an author's name, in Arabic (diacritics optional)."),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 30)."),
      },
    },
    ({ query, limit }) =>
      guard(async () => {
        const c = await getCatalog();
        const words = normalizeArabic(query).split(" ").filter(Boolean);
        const results = Object.values(c.authors)
          .filter((a) => {
            const hay = normalizeArabic(a.name);
            return words.every((w) => hay.includes(w));
          })
          .map((a) => ({
            id: a.id,
            name: a.name,
            death_hijri: a.death ?? null,
            book_count: a.books.length,
          }));
        return ok({ query, total_matches: results.length, results: results.slice(0, limit ?? 30) });
      }),
  );

  server.registerTool(
    "turath_get_author",
    {
      title: "Turath: author details + books",
      description:
        "Get an author's full biography (from the live API) plus the list of their books in the library. " +
        "Provide the author id (from `turath_find_authors` or a search hit).",
      inputSchema: {
        author_id: z.number().int().describe("Author id."),
        include_books: z.boolean().optional().describe("Include the author's book list (default true)."),
      },
    },
    ({ author_id, include_books }) =>
      guard(async () => {
        const bio = await getJson<Record<string, unknown>>(
          `${API_URL}/author?ver=3&id=${author_id}`,
        );
        const c = await getCatalog();
        const catAuthor = c.authors[String(author_id)];
        let books: Array<{ id: number; name: string; category: string; has_pdf: boolean }> | undefined;
        if ((include_books ?? true) && catAuthor) {
          books = catAuthor.books.map((bid) => {
            const b = c.books[String(bid)];
            return {
              id: bid,
              name: b?.name ?? "(unknown)",
              category: b ? (c.cats[String(b.cat_id)]?.name ?? "") : "",
              has_pdf: b?.has_pdf ?? false,
            };
          });
        }
        return ok({
          id: bio.id ?? author_id,
          name: bio.name ?? catAuthor?.name ?? null,
          death_hijri: bio.death ?? catAuthor?.death ?? null,
          biography: bio.biography ?? null,
          book_count: catAuthor?.books.length ?? books?.length ?? 0,
          books,
        });
      }),
  );
}
