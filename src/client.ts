import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Low-level client for the Turath (app.turath.io / Nuqayah) backend.
 *
 * Two hosts are involved:
 *   - api.turath.io   : dynamic JSON API (search, book, author, page, patches)
 *   - files.turath.io : static assets (catalog JSON, per-book JSON, PDFs)
 *
 * Neither host enforces a Cloudflare interactive challenge on these endpoints,
 * so a plain HTTPS request with a browser-like User-Agent is sufficient — no
 * headless browser or CF token is required.
 */

export const API_URL = "https://api.turath.io";
export const FILES_URL = "https://files.turath.io";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CACHE_DIR = path.join(os.homedir(), ".cache", "turath-mcp");
const CATALOG_CACHE = path.join(CACHE_DIR, "data-v3.json");
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000; // refresh the catalog at most once/day

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function request(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ar,en;q=0.8",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export async function getJson<T = unknown>(url: string): Promise<T> {
  const res = await request(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GET ${url} -> HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

export async function getBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await request(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

// ---------------------------------------------------------------------------
// Catalog (data-v3.json) — cached locally with a daily TTL
// ---------------------------------------------------------------------------

export interface CatCatalogEntry {
  id: number;
  name: string;
  books: number[];
}
export interface AuthorCatalogEntry {
  id: number;
  name: string;
  death?: number;
  books: number[];
}
export interface BookCatalogEntry {
  id: number;
  name: string;
  author_id: number;
  cat_id: number;
  has_pdf: boolean;
  size?: number;
  page_count?: number;
}
export interface Catalog {
  cats: Record<string, CatCatalogEntry>;
  authors: Record<string, AuthorCatalogEntry>;
  books: Record<string, BookCatalogEntry>;
  date: string;
  version: number;
}

let catalogMem: Catalog | null = null;

async function fetchAndCacheCatalog(): Promise<Catalog> {
  const data = await getJson<Catalog>(`${FILES_URL}/data-v3.json`);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CATALOG_CACHE, JSON.stringify(data), "utf8");
  catalogMem = data;
  return data;
}

export async function getCatalog(forceRefresh = false): Promise<Catalog> {
  if (catalogMem && !forceRefresh) return catalogMem;
  if (!forceRefresh) {
    try {
      const stat = await fs.stat(CATALOG_CACHE);
      if (Date.now() - stat.mtimeMs < CATALOG_TTL_MS) {
        const raw = await fs.readFile(CATALOG_CACHE, "utf8");
        catalogMem = JSON.parse(raw) as Catalog;
        return catalogMem;
      }
    } catch {
      // no cache yet — fall through to fetch
    }
  }
  try {
    return await fetchAndCacheCatalog();
  } catch (err) {
    // If the network fails but we have a stale cache, use it rather than error.
    try {
      const raw = await fs.readFile(CATALOG_CACHE, "utf8");
      catalogMem = JSON.parse(raw) as Catalog;
      return catalogMem;
    } catch {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Strip the inline HTML markup Turath embeds in page/search text. */
export function stripHtml(input: string): string {
  if (!input) return "";
  return input
    .replace(/<span\b[^>]*>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/<em>/gi, "")
    .replace(/<\/em>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Normalise Arabic for tolerant local (catalog) matching: drop diacritics /
 * tatweel, unify alef/ya/ta-marbuta forms, and remove punctuation.
 */
export function normalizeArabic(input: string): string {
  if (!input) return "";
  return input
    .replace(/[ً-ٰٟـ]/g, "") // harakat + superscript alef + tatweel
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/[‌-‏]/g, "")
    .replace(/[^؀-ۿ0-9a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The `meta` field on search hits is a JSON string; parse it defensively. */
export function parseMeta(meta: unknown): Record<string, unknown> | null {
  if (meta == null) return null;
  if (typeof meta === "object") return meta as Record<string, unknown>;
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Build absolute download URLs from a book's `pdf_links`. Most books store
 * `{root, files}` where each file is a path relative to `/pdf/{root}/`, but
 * some (externally hosted, e.g. archive.org) have no `root` and their file
 * entries are already-absolute URLs — pass those through unchanged.
 */
export function resolvePdfUrls(pdfLinks: { root?: string; files?: string[] } | undefined | null): string[] {
  if (!pdfLinks?.files?.length) return [];
  return pdfLinks.files.map((f) =>
    /^https?:\/\//i.test(f) ? f : `${FILES_URL}/pdf/${pdfLinks.root}/${f}`,
  );
}
