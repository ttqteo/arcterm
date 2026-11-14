// a prompt that names an arcterm id ("đọc agent 5065bd8c rồi…", "council:0c28170c", a pick of the chat box's @ picker)
// gets one line of context telling claude to read it with `wsh read`, which finds what the id is. kept free of the
// engine so vitest can run it; register.ts holds the prompt.submit hook. A prompt that starts with @<tab id> is not
// this: it goes to that agent (mention-core.ts).

// an id the prompt names: its kind when the prompt says it (agent, run, council, session, effort), else null, which
// `wsh read` looks up in every kind
export type Ref = { kind: string | null; id: string };

const KINDS = ["agent", "run", "council", "session", "effort"] as const;

// how many ids one line names at most: a prompt that pastes a log full of hashes is not asking to read them all
export const MAX_REFS = 5;

// kind:id, as the cockpit's addresses and the @ picker write it (tab: is agent:)
const ADDRESS = /(?<![\w/.-])(agent|tab|run|council|session|effort):([0-9a-f][0-9a-f-]{3,}[0-9a-f])(?![\w/.-])/gi;
// a hex id of 8 characters or more after a word that says what it is, "run/agent" included: "đọc agent 5065bd8c",
// "council 0c28170c368b5ab0", "phiên 4b199176". A bare hash alone is left out: it is as likely a commit
const CUED =
    /(?<![\p{L}\p{N}_])(agent|tab|run|council|session|effort|phiên|chat|hội đồng|initiative)((?:\s*\/\s*[\p{L}]+)*)\s+([0-9a-f]{8}[0-9a-f-]*)(?![\w/.-])/giu;
// a whole uuid stands alone: no commit looks like one
const UUID = /(?<![\w/.-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\w/.-])/gi;

// a cue word that names one kind; "chat" may be a live agent or a past conversation, so it names none
const CUE_KIND: Record<string, string> = {
    tab: "agent",
    phiên: "session",
    "hội đồng": "council",
    initiative: "effort",
};

function kindOf(word: string): string | null {
    const w = word.toLowerCase();
    if ((KINDS as readonly string[]).includes(w)) {
        return w;
    }
    return CUE_KIND[w] ?? null;
}

// the ids text names, in the order they first appear, each once (by id), at most MAX_REFS
export function promptRefs(text: string): Ref[] {
    const found: { at: number; ref: Ref }[] = [];
    for (const m of text.matchAll(ADDRESS)) {
        found.push({ at: m.index ?? 0, ref: { kind: kindOf(m[1] ?? ""), id: (m[2] ?? "").toLowerCase() } });
    }
    for (const m of text.matchAll(CUED)) {
        // "run/agent 5065bd8c" names two kinds: wsh read finds which
        const kind = (m[2] ?? "").trim() === "" ? kindOf(m[1] ?? "") : null;
        found.push({ at: m.index ?? 0, ref: { kind, id: (m[3] ?? "").toLowerCase() } });
    }
    for (const m of text.matchAll(UUID)) {
        found.push({ at: m.index ?? 0, ref: { kind: null, id: (m[1] ?? "").toLowerCase() } });
    }
    found.sort((a, b) => a.at - b.at);
    const out: Ref[] = [];
    for (const { ref } of found) {
        const had = out.find((r) => r.id === ref.id);
        if (had == null) {
            out.push(ref);
        } else if (had.kind == null && ref.kind != null) {
            had.kind = ref.kind;
        }
    }
    return out.slice(0, MAX_REFS);
}

const refText = (r: Ref) => (r.kind == null ? r.id : `${r.kind}:${r.id}`);

// the context line for a prompt that names ids, or null when it names none
export function refsContext(text: string): string | null {
    const refs = promptRefs(text);
    if (refs.length === 0) {
        return null;
    }
    const list = refs.map((r) => "`" + refText(r) + "`").join(", ");
    return (
        `arc: this prompt names arcterm ${refs.length === 1 ? "an id" : "ids"}: ${list}. Read ${refs.length === 1 ? "it" : "each"} with ` +
        "`wsh read <id>` before acting on it: it finds what the id is (a live agent, a run, a council, a past conversation, an " +
        "initiative) and prints its last turns, report or status. Reading sends nothing to that agent or council; message it " +
        "only when the person asks you to. An id wsh read does not know (a commit, say) is something else: carry on without it."
    );
}
