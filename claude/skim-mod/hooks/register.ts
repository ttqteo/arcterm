// skim: highlights the sentences of a reply worth reading (highlight-core.ts). claude marks them, the mod strips the
// marks before the reply is stored and draws them in the terminal alone, dimming the rest of an explanation.
// arcterm ships it beside its own mods (`wsh install-agent-hooks`); it is also published on its own as claude-skim.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";
import type { Ask } from "../types";
import {
    askOf,
    canSkim,
    hashText,
    HIGHLIGHT_SECTION,
    isAskInView,
    keepMarks,
    layout,
    parseMarks,
    rowsFromAsk,
    shownMarks,
    submitContext,
} from "./highlight-core";
import { drawAskLine, drawHighlighted, paletteFor } from "./highlight-row";
import type { Palette } from "./highlight-row";

// the width a row is laid out for where the surface has not measured
const DEFAULT_COLUMNS = 80;

// the columns a reply's text loses to the bullet before it
const REPLY_INDENT = 2;

// the system prompt section asking claude to mark
const SECTION_ID = "skim:highlight";

// the marks of stored replies, by the hash of the text stored, kept across sessions so a resumed one still draws them
const STORE_KEY = "highlightMarks";

// how often the band learns whether the question has scrolled out of view: a render hook may not write state
const ASK_POLL_MS = 250;

// an explanation draws dimmed but for its highlighted sentences, until /skim turns that off for the session
const isSkimOff = atom({ plugin: "skim", key: "isSkimOff" } as const, false);
const SKIM_OFF_STATUS = "skim off";
const ask = atom({ plugin: "skim", key: "ask" } as const, null);
const isAskHidden = atom({ plugin: "skim", key: "isAskHidden" } as const, false);

// module copies, refilled at session.start after a reload
let kept: [string, string[]][] = [];
let byHash = new Map<string, string[]>();
let palette: Palette = paletteFor(undefined);
let askNow: Ask | null = null;
// what the ask's row last reported about its rows; the timer carries it into state
let isAskOutOfView = false;
// whether the system prompt keeps the section, and whether a prompt already carried the ask. prompt.submit runs
// before the first prompt is composed, so session.start composes one to learn it early; else the first prompt would
// carry the ask a second time
let isComposed = false;
let hasTold = false;
let isInteractive = true;

function isKept(value: unknown): value is [string, string[]][] {
    return (
        Array.isArray(value) &&
        value.every((v) => Array.isArray(v) && typeof v[0] === "string" && Array.isArray(v[1]))
    );
}

async function themeOf($: EngineInterface): Promise<unknown> {
    return (await $.config.list()).find((row) => row.key === "theme")?.value;
}

async function setAsk($: EngineInterface, next: Ask | null) {
    askNow = next;
    isAskOutOfView = false;
    await update($, isAskHidden, () => false);
    await update($, ask, () => next);
}

export const register: Register = (on) => {
    on("session.start", async ($, e, next) => {
        isInteractive = e.isInteractive;
        const stored = await $.store.get(STORE_KEY);
        kept = isKept(stored) ? stored : [];
        byHash = new Map(kept);
        palette = paletteFor(await themeOf($));
        askNow = await read($, ask);
        if (isInteractive) {
            try {
                const { sections } = await $.prompt.compose();
                isComposed ||= sections.some((section) => section.id === SECTION_ID);
            } catch {
                // left to the prompt.compose hook below
            }
        }
        $.ui.status((await read($, isSkimOff)) ? SKIM_OFF_STATUS : undefined);
        await $.command.register({
            name: "skim",
            description: "Turn skim off or on: off draws explanations in full instead of dimmed around their highlighted sentences",
        });
        $.clock.every(ASK_POLL_MS, () => {
            void read($, isAskHidden).then((isHidden) => {
                if (isHidden !== isAskOutOfView) {
                    void update($, isAskHidden, () => isAskOutOfView);
                }
            });
        });
        return next(e);
    });

    on("config.set", { key: "theme" }, async ($, e, next) => {
        const done = await next(e);
        palette = paletteFor(await themeOf($));
        $.ui.invalidate("ui.render");
        return done;
    });

    // the one fixed section asking claude to mark; a headless run draws nothing, so it is not told
    on("prompt.compose", async ($, e, next) => {
        const composed = await next(e);
        if (e.traits.includes("print") || e.traits.includes("bare")) {
            return composed;
        }
        isComposed = true;
        return {
            sections: [
                ...composed.sections,
                { id: SECTION_ID, text: HIGHLIGHT_SECTION, scope: "session" as const },
            ],
        };
    });

    // the reply is stored, sent again and copied without its marks; they are kept apart under the stored text
    on("session.append", { door: "response" }, async ($, e, next) => {
        const content = [...e.message.content];
        // the row's last text, which says what the reply leaves waiting on the person
        let last: Ask | null | undefined;
        let isChanged = false;
        content.forEach((block, i) => {
            if (block.type !== "text" || typeof block.text !== "string") {
                return;
            }
            const { clean, marks } = parseMarks(block.text);
            const hash = hashText(clean);
            const question = askOf(marks);
            last = question ? { hash, text: question } : null;
            if (marks.length > 0) {
                isChanged = true;
                kept = keepMarks(kept, hash, marks);
                content[i] = { ...block, text: clean };
            }
        });
        if (isChanged) {
            byHash = new Map(kept);
            await $.store.set(STORE_KEY, kept);
        }
        if (last !== undefined && !e.agentId) {
            await setAsk($, last);
        }
        return isChanged ? next({ ...e, message: { ...e.message, content } }) : next(e);
    });

    // the person answered, or moved on; and the ask rides with the prompt where the system prompt never took it
    on("prompt.submit", async ($, e, next) => {
        if (askNow) {
            await setAsk($, null);
        }
        const context = submitContext({ isInteractive, isCommand: !!e.command, isComposed, hasTold });
        if (!context) {
            return next(e);
        }
        hasTold = true;
        return next({ ...e, context: [...(e.context ?? []), context] });
    });

    on("command.run", { command: "skim" }, async ($) => {
        const isOff = await update($, isSkimOff, (was) => !was);
        $.ui.status(isOff ? SKIM_OFF_STATUS : undefined);
        $.ui.toast(
            isOff
                ? "Skim off: explanations draw in full"
                : "Skim on: an explanation dims all but its highlighted sentences"
        );
        return {};
    });

    // marked while it streams, stored without the marks once done: either way the marked sentences draw highlighted
    on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
        const { clean, marks: written } = parseMarks(e.props.text);
        const hash = hashText(clean);
        if (askNow?.hash === hash && e.props.onScreen !== undefined) {
            const columns = (e.viewport?.columns ?? DEFAULT_COLUMNS) - REPLY_INDENT;
            isAskOutOfView = !isAskInView(e.props.onScreen, rowsFromAsk(clean, askNow.text, columns));
        }
        const all = written.length > 0 ? written : (byHash.get(hash) ?? []);
        const marks = shownMarks(all);
        if (e.surface !== "terminal" || e.props.isSummary || marks.length === 0) {
            return written.length > 0 ? next({ ...e, props: { ...e.props, text: clean } }) : next(e);
        }
        // a brainstorm turn, its last mark the question waiting on the person, draws in full: its options are to be
        // read. so does a reply marked through most of its length
        const isSkim = askOf(all) === null && canSkim(clean, marks) && !(await read($, isSkimOff));
        return drawHighlighted($.ui.resolve(e), layout(clean, marks, isSkim), isSkim, palette, e.props.isFirstOfReply);
    });

    // the question the last reply asks, above the prompt while its rows are out of view (the fullscreen terminal
    // reports them; the main screen does not, and the line never shows there)
    on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
        const waiting = await read($, ask);
        const isHidden = await read($, isAskHidden);
        if (!waiting || !isHidden || e.props.hasSurvey || e.surface !== "terminal") {
            return next(e);
        }
        return drawAskLine($.ui.resolve(e), waiting.text, await next(e));
    });
};
