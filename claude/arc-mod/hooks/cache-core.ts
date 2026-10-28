// session transcript -> the notice for the prompt-cache misses of the turn that just ended.
// a request whose prompt overlaps the previous request's but reads less of it from cache re-billed the
// gap. kept free of the engine so vitest can run it; register.ts does the read and the call.

export type TranscriptEntry = {
    type?: string;
    subtype?: string;
    timestamp?: string;
    isMeta?: boolean;
    isCompactSummary?: boolean;
    isSidechain?: boolean;
    message?: {
        id?: string;
        model?: string;
        content?: string | readonly { type?: string }[];
        usage?: {
            input_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
        };
    };
};

type Miss = { missedTokens: number; idleMs: number; ttlMs: number; isModelChanged: boolean };

type Request = { id?: string; model?: string; tokens: number; endMs: number; hasReportedCache: boolean };

// at or below this is cache-breakpoint granularity, not a miss
const NOISE_FLOOR_TOKENS = 1024;
const NOTICE_MIN_TOKENS = 20_000;
const MINUTE_MS = 60_000;
const TTL_5M_MS = 5 * MINUTE_MS;
const TTL_1H_MS = 60 * MINUTE_MS;
const SYNTHETIC_MODEL = "<synthetic>";

// the trailing line may still be mid-write, so a line that does not parse is dropped
export function transcriptEntries(text: string): TranscriptEntry[] {
    const entries: TranscriptEntry[] = [];
    for (const line of text.split("\n")) {
        if (!line.trim()) {
            continue;
        }
        try {
            entries.push(JSON.parse(line));
        } catch {
            continue;
        }
    }
    return entries;
}

// a real prompt starts a turn; tool results, skill and meta injections and compact summaries don't
function isPrompt(e: TranscriptEntry): boolean {
    if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.isSidechain) {
        return false;
    }
    const content = e.message?.content;
    return typeof content === "string" || (Array.isArray(content) && !content.some((b) => b.type === "tool_result"));
}

// misses paid by main-thread requests since the last prompt. requests are compared across turn
// boundaries so the first request after an idle gap is caught
function turnMisses(entries: readonly TranscriptEntry[]): Miss[] {
    let prev: Request | undefined;
    let ttlMs = TTL_5M_MS;
    let misses: Miss[] = [];
    for (const e of entries) {
        if (e.type === "system" && e.subtype === "compact_boundary") {
            // the next prompt is new content, not re-billed content
            prev = undefined;
            continue;
        }
        if (isPrompt(e)) {
            misses = [];
            continue;
        }
        const msg = e.message;
        const u = msg?.usage;
        if (e.type !== "assistant" || e.isSidechain || !u || msg.model === SYNTHETIC_MODEL) {
            continue;
        }
        const ts = Date.parse(e.timestamp ?? "");
        // one response is written as one line per content block, each carrying the same usage
        if (prev && prev.id === msg.id) {
            prev.endMs = ts;
            continue;
        }
        const read = u.cache_read_input_tokens ?? 0;
        const written = u.cache_creation_input_tokens ?? 0;
        const tokens = (u.input_tokens ?? 0) + read + written;
        if (tokens <= 0) {
            continue;
        }
        const hasReportedCache = read + written > 0;
        // a zero-cache request only counts once caching was seen, else caching is simply off
        if (prev && (hasReportedCache || prev.hasReportedCache)) {
            const missedTokens = Math.min(prev.tokens, tokens) - read;
            if (missedTokens > NOISE_FLOOR_TOKENS) {
                misses.push({ missedTokens, idleMs: ts - prev.endMs, ttlMs, isModelChanged: msg.model !== prev.model });
            }
        }
        if ((u.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0) {
            ttlMs = TTL_1H_MS;
        } else if ((u.cache_creation?.ephemeral_5m_input_tokens ?? 0) > 0) {
            ttlMs = TTL_5M_MS;
        }
        prev = {
            id: msg.id,
            model: msg.model,
            tokens,
            endMs: ts,
            hasReportedCache: hasReportedCache || Boolean(prev?.hasReportedCache),
        };
    }
    return misses;
}

function formatTokens(n: number): string {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

// empty when neither a model switch nor an expired cache explains the miss
function cause(miss: Miss): string {
    if (miss.isModelChanged) {
        return ", model switch";
    }
    return miss.idleMs >= miss.ttlMs ? `, ${Math.round(miss.idleMs / MINUTE_MS)}m idle` : "";
}

// one notice a turn; null when the turn re-billed nothing worth saying
export function cacheMissNotice(entries: readonly TranscriptEntry[]): string | null {
    const misses = turnMisses(entries).filter((m) => m.missedTokens >= NOTICE_MIN_TOKENS);
    const [first] = misses;
    if (!first) {
        return null;
    }
    const total = formatTokens(misses.reduce((sum, m) => sum + m.missedTokens, 0));
    return misses.length === 1
        ? `Cache miss: ${total} re-billed${cause(first)}`
        : `${misses.length} cache misses: ${total} re-billed`;
}
