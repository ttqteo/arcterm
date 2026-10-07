// the engine's wake (pkg/orchestrate composeWake), read back into the parts the transcript row draws.
// the model still reads the text as sent; this only shapes the row. wake-row.tsx does the drawing.

export type WakeKind = "alert" | "note" | "done" | "question";
export type WakeEvent = {
    kind: WakeKind;
    headline: string;
    // what follows the headline: the rest of its line, then the lines the engine put under it
    more: string[];
    // the command the line ends on, "" when it ends on none
    command: string;
};
export type Wake = { events: WakeEvent[]; questions: number; caveats: string[]; recaps: number };

const WAKE_PREFIX = "wake: ";
const CAVEATS_HEADER = "Unverified:";
const RECAPS_HEADER = "Since your last wake:";

const TRAILING_COMMAND = /^(.*)\. ((?:wsh|git) [\w -]+)$/;
const QUESTIONS = /^(\d+) questions? waiting$/;

function kindOf(body: string): WakeKind {
    if (QUESTIONS.test(body)) {
        return "question";
    }
    if (body.startsWith("run finished")) {
        return "done";
    }
    return body.includes(" passed review") ? "note" : "alert";
}

function eventOf(line: string): WakeEvent {
    const [, cut, command = ""] = TRAILING_COMMAND.exec(line) ?? [];
    const body = (cut ?? line).replace(/`/g, "");
    const kind = kindOf(body);
    // a note's own text is the reviewer's, so the headline stops before it
    const at = kind === "note" ? body.indexOf(": ") : body.indexOf(". ");
    const headline = at < 0 ? body : body.slice(0, at);
    const rest = at < 0 ? "" : body.slice(at + 2).replace(/[.:]$/, "");
    return { kind, headline: headline.replace(/[.:]$/, ""), more: rest ? [rest] : [], command };
}

// null for text that is not a wake: a tell, a review note to a worker
// ponytail: an event's own detail line that reads exactly as a section header would start that section;
// the engine flattens what it puts there today. carry the sections apart on the stream if that changes
export function parseWake(text: string): Wake | null {
    const wake: Wake = { events: [], questions: 0, caveats: [], recaps: 0 };
    let section: "events" | "caveats" | "recaps" = "events";
    for (const line of text.split("\n")) {
        if (line === CAVEATS_HEADER) {
            section = "caveats";
        } else if (line === RECAPS_HEADER) {
            section = "recaps";
        } else if (section === "caveats") {
            wake.caveats.push(line);
        } else if (section === "recaps") {
            wake.recaps++;
        } else if (line.startsWith(WAKE_PREFIX)) {
            const event = eventOf(line.slice(WAKE_PREFIX.length));
            wake.questions += Number(QUESTIONS.exec(event.headline)?.[1] ?? 0);
            wake.events.push(event);
        } else if (wake.events.length > 0 && line.trim() !== "") {
            wake.events[wake.events.length - 1].more.push(line);
        }
    }
    return wake.events.length > 0 ? wake : null;
}

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// the row's header: what the wake holds, the question line counted as its questions and not as an event
export function wakeSummary(wake: Wake): string {
    const events = wake.events.filter((e) => e.kind !== "question").length;
    return [events > 0 ? count(events, "event") : "", wake.questions > 0 ? count(wake.questions, "question") : ""]
        .filter(Boolean)
        .join(" · ");
}

export function recapLine(recaps: number): string {
    return `${count(recaps, "recap")} since your last wake`;
}

// the glyph and the indent before a headline
export const EVENT_INDENT = 4;

// whether an event's command fits on its headline's row
export function commandFits(event: WakeEvent, columns: number): boolean {
    return EVENT_INDENT + event.headline.length + 2 + event.command.length <= columns;
}
