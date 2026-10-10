// a prompt the person starts with @ and another agent's tab id goes to that agent's session instead of this one,
// through `wsh agents send`. kept free of the engine so vitest can run it; register.ts holds the prompt.submit hook.

// what a typed prompt names: the tab id or its prefix, and the message after it ("" when there is none)
export type Mention = { id: string; body: string };

// at least the 8 characters `wsh agents list` prints, so `@src/x.ts` or `@README.md` stays a file mention
const LEADING = /^\s*@([0-9a-f]{8}[0-9a-f-]*)(?=\s|$)([\s\S]*)$/i;

// null for a prompt this session keeps
export function leadingMention(text: string): Mention | null {
    const [, id, body = ""] = LEADING.exec(text) ?? [];
    return id ? { id: id.toLowerCase(), body: body.trim() } : null;
}

// why the mention cannot go as typed, null when it can. wsh agents send carries text alone, so a pasted image
// would be lost on the way
export function mentionRefusal(m: Mention, hasAttachments: boolean): string | null {
    if (m.body === "") {
        return `arc: write the message after @${m.id}`;
    }
    return hasAttachments ? "arc: an @mention sends text only; take the image out and send again" : null;
}

// the id and message ride after --, so a message starting with a dash is never read as a flag
export function sendArgs(m: Mention): string[] {
    return ["agents", "send", "--", m.id, m.body];
}

export type Ran = { exitCode: number; stdout: string; stderr: string };

// the line the dropped prompt shows the person, and whether the draft goes back in the box for another try
export type SendOutcome = { notice: string; refill: boolean };

const lines = (s: string) =>
    s
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

export function sendOutcome(id: string, ran: Ran): SendOutcome {
    if (ran.exitCode === 0) {
        return { notice: `arc: ${lines(ran.stdout)[0] ?? `sent to ${id}`}`, refill: false };
    }
    const reason = (lines(ran.stderr).pop() ?? "").replace(/^Error:\s*/, "") || `wsh exited ${ran.exitCode}`;
    return { notice: `arc: not sent to @${id}: ${reason}`, refill: true };
}
