// the cockpit's prompts for this session, as `wsh agentctl` streams them: one JSON line each. kept free
// of the engine so vitest can run it; register.ts holds the stream and the engine calls.

// what the session can be asked to do. closures over the engine: the validator follows `$` only into a
// function of the hooks file itself
export type Session = {
    submit: (text: string) => Promise<unknown>;
    command: (name: string, args: string) => Promise<unknown>;
};

// the whole lines a chunk completed, and what is left of the last one
export function takeLines(buffered: string): { lines: string[]; rest: string } {
    const parts = buffered.split("\n");
    const rest = parts.pop() ?? "";
    return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

// one stream line's text; null for a line that is not a prompt
export function controlText(line: string): string | null {
    try {
        const msg = JSON.parse(line);
        return typeof msg?.text === "string" && msg.text !== "" ? msg.text : null;
    } catch {
        return null;
    }
}

const SLASH = /^\/(\S+)\s*([\s\S]*)$/;

// runs text as typing it would: a leading slash is a command, anything else a prompt
export function deliver(session: Session, text: string): Promise<unknown> {
    const [, name, args = ""] = SLASH.exec(text) ?? [];
    return name ? session.command(name, args) : session.submit(text);
}
