import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { API_URL, FILES_URL, getJson } from "../client.js";
import { ok, guard } from "./util.js";

/**
 * Low-level escape hatch. The typed tools cover every known endpoint, but this
 * lets a caller hit any Turath endpoint directly (e.g. `/patches`, or new API
 * paths) without waiting for a typed wrapper.
 */
export function registerRawTools(server: McpServer): void {
  server.registerTool(
    "turath_api_request",
    {
      title: "Turath: raw API request (advanced)",
      description:
        "Escape hatch: perform a raw GET against a Turath host and return the parsed JSON. Use only " +
        "when a typed tool does not cover what you need. Known paths on host=api: /search, /book, " +
        "/author, /page, /patches. On host=files: /data-v3.json, /data-secondary-v3.json, " +
        "/books-v3/{id}.json. `ver=3` is added automatically for the api host if not present.",
      inputSchema: {
        host: z.enum(["api", "files"]).describe("Which host: 'api' (api.turath.io) or 'files' (files.turath.io)."),
        path: z.string().describe("Path beginning with '/', e.g. '/patches' or '/books-v3/1.json'."),
        params: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters as an object (api host only)."),
      },
    },
    ({ host, path, params }) =>
      guard(async () => {
        const base = host === "api" ? API_URL : FILES_URL;
        const p = path.startsWith("/") ? path : `/${path}`;
        const usp = new URLSearchParams();
        if (params) for (const [k, v] of Object.entries(params)) usp.set(k, String(v));
        if (host === "api" && !usp.has("ver")) usp.set("ver", "3");
        const qs = usp.toString();
        const url = `${base}${p}${qs ? `?${qs}` : ""}`;
        const data = await getJson(url);
        return ok({ url, data });
      }),
  );
}
