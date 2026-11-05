import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { API_URL, FILES_URL, getJson, getBuffer, resolvePdfUrls, stripHtml } from "../client.js";
import { ok, guard } from "./util.js";

interface BookMeta {
  name?: string;
  pdf_links?: { root?: string; files: string[] };
}
interface BookV3Page {
  text: string;
  vol?: string | number;
  page?: number;
}

function resolveOut(p: string | undefined, fallback: string): string {
  const target = p && p.trim() ? p.trim() : path.join(os.tmpdir(), fallback);
  return target.startsWith("~/") ? path.join(os.homedir(), target.slice(2)) : target;
}

export function registerDownloadTools(server: McpServer): void {
  server.registerTool(
    "turath_get_pdf_links",
    {
      title: "Turath: get PDF download links",
      description:
        "Return the direct PDF URL(s) for a book (if it has a scanned/printed PDF). Some books map to " +
        "multiple PDF files (e.g. one per volume). Use `turath_download_pdf` to save one locally.",
      inputSchema: { book_id: z.number().int().describe("Book id.") },
    },
    ({ book_id }) =>
      guard(async () => {
        const resp = await getJson<{ meta: BookMeta }>(
          `${API_URL}/book?${new URLSearchParams({ id: String(book_id), include: "meta", ver: "3" })}`,
        );
        const urls = resolvePdfUrls(resp.meta?.pdf_links);
        return ok({
          book_id,
          name: resp.meta?.name ?? null,
          has_pdf: urls.length > 0,
          pdf_count: urls.length,
          pdf_urls: urls,
        });
      }),
  );

  server.registerTool(
    "turath_download_pdf",
    {
      title: "Turath: download a book PDF",
      description:
        "Download a book's PDF to a local file and report the saved path and size. If the book has " +
        "multiple PDF parts, choose which with `file_index` (default 0). If `dest` is omitted the file " +
        "is written to the system temp directory.",
      inputSchema: {
        book_id: z.number().int().describe("Book id."),
        file_index: z.number().int().min(0).optional().describe("Which PDF part to download (default 0)."),
        dest: z.string().optional().describe("Destination file path (absolute or ~/...). Optional."),
      },
    },
    ({ book_id, file_index, dest }) =>
      guard(async () => {
        const resp = await getJson<{ meta: BookMeta }>(
          `${API_URL}/book?${new URLSearchParams({ id: String(book_id), include: "meta", ver: "3" })}`,
        );
        const urls = resolvePdfUrls(resp.meta?.pdf_links);
        if (!urls.length) throw new Error(`Book ${book_id} has no PDF.`);
        const idx = file_index ?? 0;
        if (idx < 0 || idx >= urls.length)
          throw new Error(`file_index ${idx} out of range (0..${urls.length - 1}).`);
        const url = urls[idx]!;
        const { buffer } = await getBuffer(url);
        const out = resolveOut(dest, `turath-${book_id}-${idx}.pdf`);
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, buffer);
        return ok({ book_id, source_url: url, saved_to: out, bytes: buffer.length });
      }),
  );

  server.registerTool(
    "turath_download_book_text",
    {
      title: "Turath: save full book text to a file",
      description:
        "Download the ENTIRE text of a book and save it as a UTF-8 .txt file (page markers included). " +
        "Use this for whole-book export; use `turath_get_book_text` to read pages inline. Returns the " +
        "saved path, page count, and character count.",
      inputSchema: {
        book_id: z.number().int().describe("Book id."),
        dest: z.string().optional().describe("Destination .txt path (absolute or ~/...). Optional."),
        raw_html: z.boolean().optional().describe("Keep inline markup instead of stripping (default false)."),
        page_markers: z
          .boolean()
          .optional()
          .describe("Insert a '--- [page N] ---' marker before each page (default true)."),
      },
    },
    ({ book_id, dest, raw_html, page_markers }) =>
      guard(async () => {
        const book = await getJson<{ pages: BookV3Page[] }>(`${FILES_URL}/books-v3/${book_id}.json`);
        const pages = book.pages ?? [];
        const markers = page_markers ?? true;
        const parts: string[] = [];
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i]!;
          if (markers) parts.push(`\n--- [page ${p.page ?? i + 1}${p.vol ? `, vol ${p.vol}` : ""}] ---\n`);
          parts.push(raw_html ? p.text : stripHtml(p.text));
        }
        const content = parts.join("\n");
        const out = resolveOut(dest, `turath-${book_id}.txt`);
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, content, "utf8");
        return ok({ book_id, saved_to: out, pages: pages.length, chars: content.length });
      }),
  );
}
