# turath-mcp

A Model Context Protocol (MCP) server for **Turath** ([app.turath.io](https://app.turath.io)) — the
Nuqayah Arabic / Islamic heritage library of **8,500+ classical books** with full-text search over
~900 million indexed words.

No authentication and no headless browser are required. The Turath backend
(`api.turath.io` + `files.turath.io`) sits behind Cloudflare but does **not** enforce an interactive
challenge on its data endpoints, so the server talks to it directly with plain HTTPS requests and a
browser-like `User-Agent`. The book catalog (`data-v3.json`) is cached under `~/.cache/turath-mcp`
with a 24-hour TTL.

## Tools

| Tool | What it does |
|------|--------------|
| `turath_stats` | Catalog version/date and book/author/category counts. |
| `turath_list_categories` | All 40 subject categories with book counts. |
| `turath_browse_category` | Paginated list of books in a category. |
| `turath_find_books` | Find books by **title** (diacritic-insensitive). |
| `turath_find_authors` | Find authors by **name** (diacritic-insensitive). |
| `turath_get_author` | Author biography + their book list. |
| `turath_search` | **Full-text search** across all books; filter by book/author/category, page through results. |
| `turath_get_book` | Book metadata: author, category, page count, PDF links, publisher info. |
| `turath_get_book_toc` | Table of contents (headings + volumes). |
| `turath_get_page` | Text of a single page by sequential index. |
| `turath_get_book_text` | Plain text of a book / page range in one call. |
| `turath_get_pdf_links` | Direct PDF download URL(s) for a book. |
| `turath_download_pdf` | Download a book's PDF to a local file. |
| `turath_download_book_text` | Save a book's full text to a `.txt` file. |
| `turath_api_request` | Advanced escape hatch for raw GETs against either host. |

Ids (`book_id`, `author_id`, `cat_id`) are consistent across every tool. Inline HTML markup in page
text is stripped by default (pass `raw_html: true` to keep it).

## Install

Requires Node 20 or newer.

```bash
git clone https://github.com/onequranonemessage/turath-mcp.git
cd turath-mcp
npm install
npm run build
```

## Configuration

**Claude Code**

```bash
claude mcp add turath -- node "$(pwd)/dist/index.js"
```

**Claude Desktop** — add this to `claude_desktop_config.json`
(`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows),
using the absolute path to your clone:

```json
{
  "mcpServers": {
    "turath": {
      "command": "node",
      "args": ["/absolute/path/to/turath-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop (fully quit and reopen) and start a new Claude Code session to load the server.

## API surface (reverse-engineered)

- `GET api.turath.io/search?ver=3&q=&page=&book=&author=&cat=&precision=&stem=&non_author=`
- `GET api.turath.io/book?id=&include=meta|indexes&ver=3`
- `GET api.turath.io/author?ver=3&id=`
- `GET api.turath.io/page?book_id=&pg=&ver=3`
- `GET api.turath.io/patches?version=&limit=` (incremental catalog diffs)
- `GET files.turath.io/data-v3.json` (catalog: cats/authors/books)
- `GET files.turath.io/data-secondary-v3.json` (extended author-bios + book-info)
- `GET files.turath.io/books-v3/{id}.json` (full per-book text)
- `GET files.turath.io/pdf/{root}/{file}` (scanned PDFs)
