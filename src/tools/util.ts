import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap a JSON-serialisable value as a successful MCP tool result. */
export function ok(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

/** Wrap plain text as a successful MCP tool result. */
export function okText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Wrap an error message as an MCP tool error result. */
export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Run a handler, converting thrown errors into a clean tool error result. */
export async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Normalise a param that may be a number, a string, or a list into number[]. */
export function toIdList(v: unknown): number[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: number[] = [];
  for (const item of arr) {
    if (typeof item === "number" && Number.isFinite(item)) out.push(item);
    else if (typeof item === "string") {
      for (const part of item.split(/[,\s]+/)) {
        const n = Number(part.trim());
        if (Number.isFinite(n) && part.trim() !== "") out.push(n);
      }
    }
  }
  return out;
}
