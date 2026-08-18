import { scrubString, scrubValue } from "./secrets.js";

/**
 * Logging.
 *
 * **Everything goes to stderr.** stdout is the MCP JSON-RPC channel; a single line
 * written there corrupts the protocol stream, and the symptom is an unintelligible
 * client error that points nowhere near logging (`docs/LEARNINGS.md`).
 *
 * Scrubbing happens **here, at render time**, not at the call site — a caller that
 * has to remember to scrub is a caller that will forget once.
 */

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, message: string, meta?: unknown): void {
  const head = `[${level}] ${scrubString(message)}`;
  const line =
    meta === undefined ? head : `${head} ${safeStringify(scrubValue(meta))}`;
  process.stderr.write(line + "\n");
}

/** Never let a logging failure (a cycle, a huge payload) take down the server. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

export const logger = {
  debug: (message: string, meta?: unknown): void => {
    if (process.env["DEBUG"]) write("debug", message, meta);
  },
  info: (message: string, meta?: unknown): void => write("info", message, meta),
  warn: (message: string, meta?: unknown): void => write("warn", message, meta),
  error: (message: string, meta?: unknown): void => write("error", message, meta),
};
