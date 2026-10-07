// what the cockpit asks of this session, as `wsh agentctl` streams it: one JSON line each. kept free
// of the engine so vitest can run it; register.ts holds the stream and the engine calls.

// what the session can be asked to do. closures over the engine: the validator follows `$` only into a
// function of the hooks file itself
export type Session = {
    submit: (text: string) => Promise<unknown>;
    // joins text to the turn the session is running
    steer: (text: string) => Promise<unknown>;
    command: (name: string, args: string) => Promise<unknown>;
    compact: (instructions: string) => Promise<unknown>;
};

// the whole lines a chunk completed, and what is left of the last one
export function takeLines(buffered: string): { lines: string[]; rest: string } {
    const parts = buffered.split("\n");
    const rest = parts.pop() ?? "";
    return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

// one thing the cockpit asked for: a prompt, which midTurn asks to join the running turn instead of
// waiting for it to end, or a compaction with these instructions
export type ControlMsg = { text: string; midTurn?: boolean } | { compact: string };

// the session's own turn as the mod has seen it: whether one is running, and the texts joined to it
// that no model request has carried yet
export type Turn = { isOpen: boolean; unread: string[] };

const filled = (v: unknown): v is string => typeof v === "string" && v !== "";

// one stream line's message; null for a line that asks for nothing
export function controlMsg(line: string): ControlMsg | null {
    try {
        const msg = JSON.parse(line);
        if (filled(msg?.compact)) {
            return { compact: msg.compact };
        }
        if (!filled(msg?.text)) {
            return null;
        }
        return msg.midturn === true ? { text: msg.text, midTurn: true } : { text: msg.text };
    } catch {
        return null;
    }
}

const SLASH = /^\/(\S+)\s*([\s\S]*)$/;

const COMPACT = "compact";

// runs a prompt as typing it would: a leading slash is a command, anything else a prompt. a compaction is
// the session's own call, which echoes no command into the transcript; a session that refuses it (a
// headless one) runs the command. a mid-turn text joins the running turn, and is a prompt when no turn
// runs or the session refuses the row
export function deliver(session: Session, msg: ControlMsg, turn: Turn): Promise<unknown> {
    if ("compact" in msg) {
        return session.compact(msg.compact).catch(() => session.command(COMPACT, msg.compact));
    }
    const { text } = msg;
    const [, name, args = ""] = SLASH.exec(text) ?? [];
    if (name) {
        return session.command(name, args);
    }
    if (!msg.midTurn || !turn.isOpen) {
        return session.submit(text);
    }
    turn.unread.push(text);
    return session.steer(text).catch(() => {
        turn.unread = turn.unread.filter((t) => t !== text);
        return session.submit(text);
    });
}

// closes the turn and returns the texts joined to it too late for any request to carry: the model never
// read them, so they are owed as prompts
export function endTurn(turn: Turn): string[] {
    const unread = turn.unread;
    turn.isOpen = false;
    turn.unread = [];
    return unread;
}

// the one transcript line for a text that joined the running turn, whose own row draws nothing. the
// engine leads it with the plugin's name
export function steerNotice(text: string): string {
    return `read mid-turn: ${text.replace(/\s+/g, " ").trim()}`;
}
