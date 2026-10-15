// arcterm's second Claude Code mod: draws the transcript rows of prompts the arc mod submitted. It is a
// mod of its own because the engine never runs a plugin's render hook on a row that plugin raised.
// `wsh install-agent-hooks` installs it beside the arc mod; outside arcterm no such row exists.
// It also highlights the sentences of a reply worth reading (highlight-core.ts): claude marks them, the mod
// strips the marks before the reply is stored and draws them in the terminal alone.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";
import type { Ask } from "../types";
import {
    askOf,
    hashText,
    HIGHLIGHT_SECTION,
    isAskInView,
    keepMarks,
    layout,
    parseMarks,
    rowsFromAsk,
    shownMarks,
} from "./highlight-core";
import { drawAskLine, drawHighlighted, paletteFor } from "./highlight-row";
import type { Palette } from "./highlight-row";
import { parseWake } from "./wake-core";
import { drawWakeRow } from "./wake-row";

// the width a row is laid out for where the surface has not measured
const DEFAULT_COLUMNS = 80;

// the columns a reply's text loses to the bullet before it
const REPLY_INDENT = 2;

// the marks of stored replies, by the hash of the text stored, kept across sessions so a resumed one still draws them
const STORE_KEY = "highlightMarks";

// how often the band learns whether the question has scrolled out of view: a render hook may not write state
const ASK_POLL_MS = 250;

const skim = atom({ plugin: "arc-view", key: "skim" } as const, false);
const ask = atom({ plugin: "arc-view", key: "ask" } as const, null);
const isAskHidden = atom({ plugin: "arc-view", key: "isAskHidden" } as const, false);

// module copies, refilled at session.start after a reload
let kept: [string, string[]][] = [];
let byHash = new Map<string, string[]>();
let palette: Palette = paletteFor(undefined);
let askNow: Ask | null = null;
// what the ask's row last reported about its rows; the timer carries it into state
let isAskOutOfView = false;

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
    // a wake is drawn as what it holds; the model reads it as sent, and ctrl+o shows that text
    on("ui.render", { component: "UserMessage", props: { origin: { kind: "plugin", name: "arc" } } }, ($, e, next) => {
        const wake = e.props.isExpanded ? null : parseWake(e.props.text);
        return wake ? drawWakeRow($.ui.resolve(e), wake, e.viewport?.columns ?? DEFAULT_COLUMNS) : next(e);
    });

    on("session.start", async ($, e, next) => {
        const stored = await $.store.get(STORE_KEY);
        kept = isKept(stored) ? stored : [];
        byHash = new Map(kept);
        palette = paletteFor(await themeOf($));
        askNow = await read($, ask);
        $.ui.status((await read($, skim)) ? "skim" : undefined);
        await $.command.register({
            name: "skim",
            description: "Dim what a reply did not highlight, so its marked sentences read alone; again to undo",
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
        return {
            sections: [
                ...composed.sections,
                { id: "arc-view:highlight", text: HIGHLIGHT_SECTION, scope: "session" as const },
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

    // the person answered, or moved on
    on("prompt.submit", async ($, e, next) => {
        if (askNow) {
            await setAsk($, null);
        }
        return next(e);
    });

    on("command.run", { command: "skim" }, async ($) => {
        const isOn = await update($, skim, (was) => !was);
        $.ui.status(isOn ? "skim" : undefined);
        $.ui.toast(isOn ? "Skim on: only the highlighted sentences stay bright" : "Skim off");
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
        const marks = shownMarks(written.length > 0 ? written : (byHash.get(hash) ?? []));
        if (e.surface !== "terminal" || e.props.isSummary || marks.length === 0) {
            return written.length > 0 ? next({ ...e, props: { ...e.props, text: clean } }) : next(e);
        }
        const isSkim = await read($, skim);
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
