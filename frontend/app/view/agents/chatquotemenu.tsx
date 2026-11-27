// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reply to text selected in Chat's conversation (chatquote.ts): the passage goes into the agent's chat box as a quote,
// the caret under it. Two ways in: a small ↩ button diagonally off the selection's top-right corner (its bottom-right
// when the pane has no room above), so it never covers the words it would quote or the ones after them, and a right-click on the selection, which opens a menu of Reply and Copy, and in Chat Save as
// idea (a new idea on Jarvis's Ideas), Save for later (a later chunk of an initiative) and Add note (a note in the
// palette's Notes), each named by the passage's first
// sentence and holding the passage under the agent it came from (chatsaveselection.ts). It takes any text
// in the conversation, Claude's reply, your message or a tool's output alike, and only while the agent has a chat box to
// take it. A right-click off the selection, or with nothing selected, leaves the row's own menu (Copy text, Fork from
// here…) as it was. The button is drawn fixed in a portal, so no row's layout or transform moves it, and follows the
// selection as the conversation scrolls. QuoteMenu is the same over any box (a council's chat, councilchat.tsx): the
// box is named by `target`, given the selection.
//
// Save for later (savelater.ts) keeps the passage as a later chunk of an initiative, to tick off from Jarvis. An agent
// linked to an initiative saves into it at once (the item's sublabel names it); an unlinked one opens the initiative
// picker at the pointer. Its toast offers Open and Move to… (the picker again, at the button pressed).

import { pushToast } from "@/app/cockpit/notificationstore";
import { saveNoteDraft } from "@/app/cockpit/palette-notesstore";
import { openNotesList } from "@/app/cockpit/quicknote";
import { contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { briefingStateAtom } from "@/app/view/jarvis/briefingstore";
import { createIdea, effortDetailAtom, loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { InitiativePicker } from "@/app/view/jarvis/initiativepicker";
import { openAddress } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { Clock, Copy, Lightbulb, Reply, StickyNote } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AgentsViewModel } from "./agents";
import { chatBoxText, hasChatBox, replaceChatBox } from "./chatinsert";
import { withChatQuote, withQuote } from "./chatquote";
import {
    laterItem,
    laterSublabel,
    passageFirstLine,
    savedBody,
    selectionTitle,
    type SavedFrom,
} from "./chatsaveselection";
import { LaterSaveError, moveLaterChunk, saveLaterTo } from "./savelater";

const BTN = 22;
// the longest initiative title a toast spells out
const TOAST_TITLE_MAX = 60;
// how far the button sits off the selection's corner, across and up
const CORNER_GAP = 2;

function editable(node: Node | null): boolean {
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest("input,textarea,[contenteditable='true'],[contenteditable='']") != null;
}

// the nearest ancestor that scrolls: the selection's rect is checked against it, so the button hides with a passage
// scrolled out of the pane instead of pinning to its edge
function scrollParent(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p != null; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") {
            return p;
        }
    }
    return null;
}

// the title of an initiative as the app last read it: the briefing's summary, else the cached detail (the agent's header
// loads it); undefined while neither has it
function initiativeTitleAtom(oref: string) {
    return atom(
        (get) =>
            get(briefingStateAtom).snapshot?.state.efforts?.find((e) => e.oref === oref)?.title ??
            get(effortDetailAtom).get(oref)?.title
    );
}
const NO_TITLE = atom<string | undefined>(undefined);

export function ChatQuoteMenu({
    agentId,
    name,
    project,
    session,
    effortId,
    model,
    rootRef,
}: {
    agentId: string;
    name: string;
    project?: string;
    session?: string;
    // the initiative the agent works on (a bare oid): Save for later goes there at once, and its menu item names it
    effortId?: string;
    model?: AgentsViewModel;
    rootRef: RefObject<HTMLElement>;
}) {
    const target = useMemo<QuoteTarget>(
        () => ({
            ready: () => hasChatBox(agentId),
            read: () => chatBoxText(agentId),
            write: (text) => replaceChatBox(agentId, text),
            // the quote goes before the folded pastes at the draft's end (chatquote.ts withChatQuote)
            quote: withChatQuote,
        }),
        [agentId]
    );
    const oref = effortId != null && effortId !== "" ? "effort:" + effortId : undefined;
    const title = useAtomValue(useMemo(() => (oref != null ? initiativeTitleAtom(oref) : NO_TITLE), [oref]));
    useEffect(() => {
        // the title is decoration on the menu item: a failed load leaves "to its initiative", which still saves there
        if (oref != null && title == null) {
            loadEffortDetail(oref).catch(() => {});
        }
    }, [oref, title]);
    const save = useMemo<SaveTarget>(
        () => ({
            from: { agentId, name },
            project,
            session,
            model,
            effort: oref != null ? { oref, title } : undefined,
        }),
        [agentId, name, project, session, model, oref, title]
    );
    return <QuoteMenu rootRef={rootRef} target={target} save={save} />;
}

/** Where Save as idea, Save for later and Add note say the passage came from; `model` opens what they made from their
 *  toast. */
export interface SaveTarget {
    from: SavedFrom;
    project?: string;
    // the conversation's id (its transcript's stem): a note keeps it, so Notes can open the conversation again
    session?: string;
    model?: AgentsViewModel;
    // the initiative the agent is linked to (its oref, and its title once known): Save for later adds there without
    // asking. Left out for an agent that is not linked, whose Save for later opens the picker
    effort?: { oref: string; title?: string };
}

function failed(what: string, e: unknown) {
    pushToast({ title: `Couldn't ${what}`, message: e instanceof Error ? e.message : String(e), level: "error" });
}

/** What the toast's Move to… needs to open its picker: the initiative the chunk sits in, the label it took there, and
 *  the passage it holds (its first line names it on the next toast). */
interface LaterMove {
    from: string;
    label: string;
    text: string;
    // where the Move to… button was pressed: the picker opens there
    at: { x: number; y: number };
}

// the passage as a later chunk of `target` (an initiative's oref, or "new" for one made from this session), toasted with
// Open and Move to…. "new" makes the initiative first, so a failure after it leaves that one behind, empty, in Ideas:
// the failure toast names it.
async function saveLater(text: string, save: SaveTarget, target: string, openMove: (m: LaterMove) => void) {
    try {
        const saved = await saveLaterTo(target, [laterItem(text, save.from, save.session, new Date())], {
            ...save.from,
            project: save.project,
            conversation: save.session,
        });
        const model = save.model;
        const label = saved.labels[0];
        const move = {
            label: "Move to…",
            run: (at?: { x: number; y: number }) =>
                openMove({
                    from: saved.oref,
                    label,
                    text,
                    at: at ?? { x: window.innerWidth - 24, y: window.innerHeight - 24 },
                }),
        };
        const open =
            model != null
                ? { label: "Open", run: () => fireAndForget(() => openAddress(model, saved.oref)) }
                : undefined;
        pushToast({
            // a long initiative title would stand the toast tall
            title: `Saved for later in ${passageFirstLine(saved.title, TOAST_TITLE_MAX)}`,
            message: passageFirstLine(text),
            level: "info",
            check: true,
            // the choices need a moment more than a plain confirmation
            ttlMs: 8000,
            action: open ?? move,
            ...(open != null ? { alt: move } : {}),
        });
    } catch (e) {
        failed(
            "save it for later",
            e instanceof LaterSaveError
                ? new Error(
                      `${e.message} The new initiative “${passageFirstLine(e.created.title, TOAST_TITLE_MAX)}” was made and is in Ideas, empty.`
                  )
                : e
        );
    }
}

// the later chunk `m` moved to the initiative the picker gave (an oref), toasted with Open
async function moveLater(m: LaterMove, to: string, save: SaveTarget) {
    try {
        const moved = await moveLaterChunk(m.from, m.label, to);
        const model = save.model;
        pushToast({
            title: `Moved to ${passageFirstLine(moved.title, TOAST_TITLE_MAX)}`,
            message: passageFirstLine(m.text),
            level: "info",
            check: true,
            ...(model != null
                ? { action: { label: "Open", run: () => fireAndForget(() => openAddress(model, to)) } }
                : {}),
        });
    } catch (e) {
        failed("move it", e);
    }
}

// an idea on Jarvis's Ideas column, named by the passage's first sentence, the passage and its agent as its objective
async function saveIdea(text: string, save: SaveTarget) {
    const title = selectionTitle(text);
    try {
        const oref = await createIdea(title, {
            project: save.project,
            note: savedBody(text, save.from, new Date()),
            agentId: save.from.agentId,
        });
        const model = save.model;
        pushToast({
            title: "Saved as idea",
            message: title,
            level: "info",
            check: true,
            ...(model != null
                ? { action: { label: "Open", run: () => fireAndForget(() => openAddress(model, oref)) } }
                : {}),
        });
    } catch (e) {
        failed("save the idea", e);
    }
}

// a note in the palette's Notes, the same title and body, its project and conversation in its frontmatter (Notes shows
// them as a badge and an Open conversation link). Its Open shows the Notes list, the new note first (the router's
// "note" is a vault memory note, openref.ts loadNote, not one of these)
async function saveNote(text: string, save: SaveTarget) {
    const title = selectionTitle(text);
    try {
        // with no conversation id to keep, the tab's address is the only way back, so the body keeps it
        const body = savedBody(text, save.from, new Date(), !save.session);
        await saveNoteDraft(
            { id: null, title, body, saved: { title: "", body: "" } },
            { project: save.project, session: save.session }
        );
        const model = save.model;
        pushToast({
            title: "Added to Notes",
            message: title,
            level: "info",
            check: true,
            ...(model != null ? { action: { label: "Open", run: () => openNotesList(model) } } : {}),
        });
    } catch (e) {
        failed("add the note", e);
    }
}

/** The box a quote goes into, given the selected range (a council has two boxes: the thread's and the channel's).
 *  `ready` false hides the button and leaves the row's own menu; `write` false keeps the selection, as nothing took
 *  the quote. */
export interface QuoteTarget {
    ready: (range: Range) => boolean;
    read: (range: Range) => string;
    write: (text: string, range: Range) => boolean;
    /** how the quote goes into the box's text (withQuote, at its end, when left out) */
    quote?: (box: string, selected: string) => string | null;
}

type Picked = { range: Range; text: string };

// the current selection, when it is text of the conversation a box can take; null otherwise
function picked(root: HTMLElement, target: QuoteTarget): Picked | null {
    const s = window.getSelection();
    if (s == null || s.isCollapsed || s.rangeCount === 0) {
        return null;
    }
    const range = s.getRangeAt(0);
    if (
        !root.contains(range.commonAncestorContainer) ||
        editable(range.commonAncestorContainer) ||
        !target.ready(range)
    ) {
        return null;
    }
    const text = s.toString();
    return text.trim() === "" ? null : { range: range.cloneRange(), text };
}

// the selection, when a press at (x, y) lands on it
function pickedAt(root: HTMLElement, target: QuoteTarget, x: number, y: number): Picked | null {
    const p = picked(root, target);
    const pad = 4;
    const on =
        p != null &&
        Array.from(p.range.getClientRects()).some(
            (r) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
        );
    return on ? p : null;
}

function reply(target: QuoteTarget, p: Picked) {
    const next = (target.quote ?? withQuote)(target.read(p.range), p.text);
    if (target.write(next, p.range)) {
        window.getSelection()?.removeAllRanges();
    }
}

export function QuoteMenu({
    rootRef,
    target,
    save,
}: {
    rootRef: RefObject<HTMLElement>;
    target: QuoteTarget;
    save?: SaveTarget;
}) {
    const [at, setAt] = useState<{ top: number; left: number } | null>(null);
    // the pickers Save for later (at the menu's pointer) and its toast's Move to… (at the button pressed) open
    const [laterAt, setLaterAt] = useState<{ x: number; y: number; text: string; open: boolean } | null>(null);
    const [moveAt, setMoveAt] = useState<(LaterMove & { open: boolean }) | null>(null);
    // the toast outlives the menu's host when the agent's chat closes: its Move to… then has no picker to open
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    // A closed picker stays mounted while its reveal plays out, and still takes a press or Enter: a second pick in that
    // time would save (or move) the item twice. Each opening arms one pick.
    const laterTaken = useRef(false);
    const moveTaken = useRef(false);
    const openLaterPicker = useCallback((p: { x: number; y: number; text: string }) => {
        laterTaken.current = false;
        setLaterAt({ ...p, open: true });
    }, []);
    const openMove = useCallback((m: LaterMove) => {
        if (!alive.current) {
            failed("move it", new Error("The agent's chat has closed."));
            return;
        }
        moveTaken.current = false;
        setMoveAt({ ...m, open: true });
    }, []);
    const moveFrom = moveAt?.from;
    const moveExcluding = useMemo(() => (moveFrom != null ? [moveFrom] : undefined), [moveFrom]);

    // the button: diagonally off the selection's top-right corner (its widest line's end), the bottom-right corner when
    // the pane has no room above; held inside the pane
    useEffect(() => {
        const update = () => {
            const root = rootRef.current;
            const p = root != null ? picked(root, target) : null;
            const rects = p != null ? Array.from(p.range.getClientRects()).filter((r) => r.width > 0) : [];
            const first = rects[0];
            const last = rects[rects.length - 1];
            if (root == null || p == null || first == null || last == null) {
                setAt(null);
                return;
            }
            // the pane the passage scrolls in (a council's channel or thread, inside the root), else the root's
            const start = p.range.startContainer;
            const from = start instanceof HTMLElement ? start : start.parentElement;
            const view = (from != null && root.contains(from)
                ? scrollParent(from)
                : scrollParent(root)
            )?.getBoundingClientRect() ?? {
                top: 0,
                bottom: window.innerHeight,
                left: 0,
                right: window.innerWidth,
            };
            if (last.bottom < view.top || first.top > view.bottom - 28) {
                setAt(null);
                return;
            }
            // diagonal off the selection's corner: its widest line's right end, a hair out
            const right = Math.max(...rects.map((r) => r.right));
            const above = first.top - BTN - CORNER_GAP;
            const top = above >= view.top + 4 ? above : last.bottom + CORNER_GAP;
            if (top + BTN > view.bottom - 4) {
                setAt(null);
                return;
            }
            setAt({
                top,
                left: Math.min(Math.max(right + CORNER_GAP, view.left + 8), view.right - BTN - 8),
            });
        };
        document.addEventListener("selectionchange", update);
        // the conversation scrolls under a kept selection: the button follows it (capture: the scroll is the pane's)
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            document.removeEventListener("selectionchange", update);
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [rootRef, target]);

    // the right-click menu
    useEffect(() => {
        // the selection as it was at the press that opens the menu: WebKit selects the word under a right-click before
        // the contextmenu event, so a right-click on a row with nothing selected would otherwise read as one on a
        // selection. undefined: no press seen (the menu key), so the selection as it is now counts
        let held: Picked | null | undefined;
        const inRoot = (e: MouseEvent) => {
            const root = rootRef.current;
            return root != null && e.target instanceof Node && root.contains(e.target) ? root : null;
        };
        const onDown = (e: MouseEvent) => {
            const root = inRoot(e);
            const opens = e.button === 2 || (e.button === 0 && e.ctrlKey);
            held = root != null && opens ? pickedAt(root, target, e.clientX, e.clientY) : undefined;
        };
        const onMenu = (e: MouseEvent) => {
            const root = inRoot(e);
            const p = held !== undefined ? held : root != null ? pickedAt(root, target, e.clientX, e.clientY) : null;
            held = undefined;
            if (root == null || p == null) {
                return;
            }
            // before the row's own menu (React's handler on the root) sees it
            e.preventDefault();
            e.stopPropagation();
            globalStore.set(contextMenuAtom, {
                items: [
                    {
                        label: "Reply",
                        sublabel: "quote it in the box",
                        icon: <Reply size={15} />,
                        click: () => reply(target, p),
                        attrs: { "data-chat-quote": "" },
                    },
                    {
                        label: "Copy",
                        icon: <Copy size={15} />,
                        click: () => void navigator.clipboard.writeText(p.text),
                    },
                    // a passage of no words gets no title, and `picked` already refuses one
                    ...(save != null && selectionTitle(p.text) !== ""
                        ? [
                              { type: "separator" as const },
                              {
                                  label: "Save as idea",
                                  sublabel: "to Jarvis's Ideas",
                                  icon: <Lightbulb size={15} />,
                                  click: () => void saveIdea(p.text, save),
                                  attrs: { "data-chat-save-idea": "" },
                              },
                              {
                                  label: "Save for later",
                                  sublabel: laterSublabel(save.effort != null, save.effort?.title),
                                  icon: <Clock size={15} />,
                                  // linked: into its initiative at once; not linked: the picker, at the pointer
                                  click: () =>
                                      save.effort != null
                                          ? void saveLater(p.text, save, save.effort.oref, openMove)
                                          : openLaterPicker({ x: e.clientX, y: e.clientY, text: p.text }),
                                  attrs: { "data-save-later": "" },
                              },
                              {
                                  label: "Add note",
                                  icon: <StickyNote size={15} />,
                                  click: () => void saveNote(p.text, save),
                                  attrs: { "data-chat-add-note": "" },
                              },
                          ]
                        : []),
                ],
                x: e.clientX,
                y: e.clientY,
            });
        };
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("contextmenu", onMenu, true);
        return () => {
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("contextmenu", onMenu, true);
        };
    }, [rootRef, target, save, openMove, openLaterPicker]);

    const press = () => {
        const root = rootRef.current;
        const p = root != null ? picked(root, target) : null;
        if (p != null) {
            reply(target, p);
        }
        setAt(null);
    };
    const closeLater = () => setLaterAt((p) => (p != null ? { ...p, open: false } : p));
    const closeMove = () => setMoveAt((p) => (p != null ? { ...p, open: false } : p));
    return (
        <>
            {/* two pickers, one per placement (a point set on one instance outlives an anchor given to it later). Each
                stays mounted once it has opened and is driven by `open`, so the reveal plays out on close */}
            {save != null && laterAt != null ? (
                <InitiativePicker
                    open={laterAt.open}
                    anchor={null}
                    point={{ x: laterAt.x, y: laterAt.y }}
                    project={save.project ?? ""}
                    recent
                    title="Save for later in…"
                    pickVerb="save"
                    onPick={(pick) => {
                        closeLater();
                        if (!laterTaken.current) {
                            laterTaken.current = true;
                            void saveLater(laterAt.text, save, pick, openMove);
                        }
                    }}
                    onClose={closeLater}
                />
            ) : null}
            {save != null && moveAt != null ? (
                <InitiativePicker
                    open={moveAt.open}
                    anchor={null}
                    point={moveAt.at}
                    project={save.project ?? ""}
                    // the chunk cannot move to the initiative it is in, and a new one is not a move
                    excluding={moveExcluding}
                    newLabel={null}
                    recent
                    title="Move to…"
                    pickVerb="move"
                    onPick={(pick) => {
                        closeMove();
                        if (!moveTaken.current) {
                            moveTaken.current = true;
                            void moveLater(moveAt, pick, save);
                        }
                    }}
                    onClose={closeMove}
                />
            ) : null}
            {at != null
                ? createPortal(
                      <button
                          type="button"
                          data-chat-quote-button
                          title="Reply: quote the selection in the box"
                          aria-label="Reply"
                          // keep the selection: a press would otherwise collapse it before the click
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={press}
                          style={{ top: at.top, left: at.left, width: BTN, height: BTN }}
                          className={cn(
                              "fixed z-50 flex cursor-pointer items-center justify-center rounded-[6px] border border-border p-0",
                              "bg-surface-raised text-secondary shadow-popover-sm hover:bg-surface-hover hover:text-accent"
                          )}
                      >
                          <Reply size={13} strokeWidth={2.2} aria-hidden />
                      </button>,
                      document.body
                  )
                : null}
        </>
    );
}
