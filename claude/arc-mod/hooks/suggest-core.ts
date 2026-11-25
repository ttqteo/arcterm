// Chat's suggested replies, worked out in this claude at the end of its turn (pkg/chatsuggest/hook.go): `wsh chatsuggest
// begin` hands back the completion to run (wavesrv's prompt, with the person's habits), `$.model.complete` runs it on
// haiku in this process, and `wsh chatsuggest end` brings the answer back, which Chat then takes instead of starting a
// claude of its own. Anything that goes wrong here leaves Chat to make that call itself, as before.

/** the model the replies are worked out on: picking a next reply from a few lines is a short classification */
export const SUGGEST_MODEL = "haiku";

/** how hard it thinks first: low, as the replies are a short pick; it cuts haiku's ~300 tokens of thinking to ~80 and
 *  the call from ~2 s to ~1.3 s (measured 2026-11-19) */
export const SUGGEST_EFFORT = "low";

/** the reply's cap: the replies are up to five short lines, with a little thinking first, and for a question that
 *  offers options the answer now carries a description line per chip and a pick line (hook.go ParseAnswer) */
export const SUGGEST_MAX_TOKENS = 3072;

/** how long the completion may take before it is cut (`timeoutMs` abandons the request): well inside the 10 s wavesrv
 *  waits for the end (hook.go hookMax), so a slow call ends the turn as failed and Chat's own call starts at once instead
 *  of after wavesrv's wait runs out, while this one still runs. The call takes ~1-1.5 s (log, 2026-11-19) */
export const SUGGEST_TIMEOUT_MS = 5_000;

/** the person's last messages the model reads for their words and language */
const RECENT = 6;

/** One row of the conversation, as `$.session.messages()` gives it. */
export interface Row {
    role: "user" | "assistant";
    text: string;
}

/** Pure: the person's last typed messages, oldest first, each on one line, as Chat reads them from its transcript
 *  (frontend chatsuggest.ts recentPrompts): user rows with text, less the rows Claude Code writes as the user's (a
 *  `<command-name>`, a `<task-notification>`, a reminder: they open with a tag) and what a paste of pictures brought
 *  along. */
export function recentPrompts(rows: readonly Row[], n = RECENT): string[] {
    const out: string[] = [];
    for (const r of [...rows].reverse()) {
        if (out.length >= n) {
            break;
        }
        if (r.role !== "user" || r.text.trimStart().startsWith("<")) {
            continue;
        }
        const own = (r.text.split(/\n\s*Attached images:/)[0] ?? "").replace(/\s+/g, " ").trim();
        if (own !== "") {
            out.unshift(own);
        }
    }
    return out;
}

/** Pure: whether a turn's end gets its replies worked out here: the main loop's answer, with text, in an arcterm block,
 *  and not in an engine run's tree (a run's worker: nobody reads its Chat, and its turns are many). */
export function wantsSuggest(
    e: { agentId?: string; reason: string; answer: string },
    inArc: boolean,
    engineTree: boolean
): boolean {
    return inArc && !engineTree && e.agentId === undefined && e.reason === "answer" && e.answer.trim() !== "";
}

/** What `wsh chatsuggest begin` reads on stdin. */
export function beginPayload(answer: string, recent: readonly string[]): string {
    return JSON.stringify({ reply: answer, recent });
}

/** The completion `wsh chatsuggest begin` hands back, or null when its line is not one. */
export interface SuggestCall {
    key: string;
    system: string;
    prompt: string;
}

/** Pure: begin's stdout read: one JSON line `{key, system, prompt}`; anything else is null. */
export function parseBegin(stdout: string): SuggestCall | null {
    try {
        const v: unknown = JSON.parse(stdout.trim());
        if (v == null || typeof v !== "object") {
            return null;
        }
        const { key, system, prompt } = v as Record<string, unknown>;
        if (typeof key !== "string" || key === "" || typeof system !== "string" || typeof prompt !== "string") {
            return null;
        }
        return { key, system, prompt };
    } catch {
        return null;
    }
}

/** The arguments of `wsh chatsuggest begin`. */
export function beginArgs(): string[] {
    return ["chatsuggest", "begin"];
}

/** The arguments of `wsh chatsuggest end`: `failed` when the completion gave no text, and stdin is then not read. */
export function endArgs(key: string, failed: boolean): string[] {
    return failed ? ["chatsuggest", "end", "--key", key, "--failed"] : ["chatsuggest", "end", "--key", key];
}
