import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerSearchTools } from "./tools/search.js";
import { registerBookTools } from "./tools/books.js";
import { registerDownloadTools } from "./tools/download.js";
import { registerRawTools } from "./tools/raw.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "turath-mcp", version: "0.1.0" },
    {
      instructions:
        "Tools for interacting with Turath (app.turath.io) — the Nuqayah Arabic/Islamic heritage " +
        "library of 8500+ classical books. No authentication is required. Typical flow: use " +
        "`turath_search` to search full text across all books (filter by book/author/category); use " +
        "`turath_find_books` / `turath_find_authors` to locate a title or author by name; then " +
        "`turath_get_book`, `turath_get_book_toc`, `turath_get_page`, and `turath_get_book_text` to " +
        "read. `turath_list_categories` / `turath_browse_category` browse the subject tree. " +
        "`turath_get_pdf_links` / `turath_download_pdf` / `turath_download_book_text` export content. " +
        "All ids (book_id, author_id, cat_id) are consistent across tools. Queries and results are in " +
        "Arabic; matching is diacritic-insensitive.",
    },
  );

  registerCatalogTools(server);
  registerSearchTools(server);
  registerBookTools(server);
  registerDownloadTools(server);
  registerRawTools(server);

  return server;
}
