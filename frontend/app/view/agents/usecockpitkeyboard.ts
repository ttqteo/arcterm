// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit surface's keyboard dispatch (cursor nav, answer selection, surface switch, triage keys).
// These keys are cockpit-local — handled here, not by the global keybinding registry. Extracted from
// cockpitsurface.tsx as a hook taking a single deps object.

import { peekTarget } from "@/app/view/jarvis/openref";
import { type KeyboardEvent, type MutableRefObject } from "react";
import type { AgentsViewModel } from "./agents";
import { answerDigitTarget, canSubmitAsk, hasAnswerableAsk, moveCursor, nextAskId, type AgentVM } from "./agentsviewmodel";
import { askerAt, columnJump, type RowTarget } from "./cardgridlayout";
import { isRowKey, rowCardId } from "./leadcardmodel";
import type { Dir } from "./officeboss";
import { officeKey, officeKeyName, type OfficeLayer } from "./officecontrols";
import { toggleOfficeMute } from "./officestore";
import { BOARD_KEY, LIFT_KEY } from "./officeplanmodel";

export const ARROW_DIR: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** What the Cockpit's keys can ask of the office while it shows Office (cockpitsurface.tsx binds it to the office's
 *  handle). officecontrols.ts decides what each key does. */
export interface OfficeKeys {
    layer(): OfficeLayer;
    menuOpen(): boolean;
    walk(dir: Dir): void;
    talk(): boolean;
    card(): boolean;
    move(delta: -1 | 1): void;
    activate(): void;
    back(): void;
    toggleMenu(): void;
    desk(delta: -1 | 1): void;
    nextAsk(): void;
    // ◀ ▶ over the notice board's box: the page a row on
    pageBoard(delta: -1 | 1): void;
    // PageUp / PageDown: ride the lift to the next floor up (+1) or down (-1); nothing past the top or the ground floor.
    // With a room carried it rides with the room, and past the top the room's target is a new floor
    floor(delta: -1 | 1): void;
    // g: pick up the room the boss stands in; nothing when it stands in none
    grab(): void;
    // the carry's keys: the arrows move the target to a slot of the floor, Space or ↵ puts the room down, Esc and g put
    // it back
    slot(dir: Dir): void;
    drop(): void;
    cancel(): void;
}

export type CockpitKeyDeps = {
    model: AgentsViewModel;
    navigableIds: string[];
    cursorId: string | undefined;
    setCursorId: (v: (string | undefined) | ((p: string | undefined) => string | undefined)) => void;
    answerTab: Record<string, number>;
    answerSel: Record<string, Record<number, Set<number>>>;
    navCols: string[][];
    rowTargets: Record<string, RowTarget>;
    askTargets: string[];
    roster: AgentVM[];
    lastJumpRef: MutableRefObject<string | undefined>;
    setOpenComposerId: (v: string | undefined) => void;
    selectQuestion: (id: string, qi: number) => void;
    toggleAnswer: (id: string, qi: number, oi: number) => void;
    submitAnswer: (id: string) => void;
    toggleBackground: (id: string) => void;
    openFocus: (id: string, reply: boolean) => void;
    scrollToPulse: (id: string) => void;
    focusRowComposer: (id: string) => void;
    // set while the Cockpit shows Office: the arrows walk, j k n go desk by desk in office order
    office?: OfficeKeys;
    toggleView?: () => void;
};

export function useCockpitKeyboard(deps: CockpitKeyDeps): (e: KeyboardEvent) => void {
    const {
        model,
        navigableIds,
        cursorId,
        setCursorId,
        answerTab,
        answerSel,
        navCols,
        rowTargets,
        askTargets,
        roster,
        lastJumpRef,
        setOpenComposerId,
        selectQuestion,
        toggleAnswer,
        submitAnswer,
        toggleBackground,
        openFocus,
        scrollToPulse,
        focusRowComposer,
        office,
        toggleView,
    } = deps;

    return (e: KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) {
            return; // typing — let the input own its keys
        }
        // in Office, Space is the A button: it does what Enter does, the Cockpit's own Enter below too
        const key = office ? officeKeyName(e.key) : e.key;
        // a room carried takes every key until it is put down (officecontrols.ts), the view switch too
        if (key === "o" && !e.metaKey && !e.ctrlKey && !e.altKey && toggleView && office?.layer() !== "carry") {
            e.preventDefault();
            toggleView();
            return;
        }
        if (office) {
            const act = officeKey(office.layer(), office.menuOpen(), key, {
                meta: e.metaKey,
                ctrl: e.ctrlKey,
                alt: e.altKey,
            });
            switch (act.do) {
                case "walk":
                    e.preventDefault();
                    office.walk(act.dir);
                    return;
                case "move":
                    e.preventDefault();
                    office.move(act.delta);
                    return;
                case "activate":
                    e.preventDefault();
                    office.activate();
                    return;
                case "talk":
                    // Space or ↵ over the boss's desk; at no desk, it opens the cursor's agent as Enter does below
                    if (office.talk()) {
                        e.preventDefault();
                        return;
                    }
                    break;
                case "card":
                    if (office.card()) {
                        e.preventDefault();
                    }
                    return;
                case "sound":
                    e.preventDefault();
                    toggleOfficeMute();
                    return;
                case "back":
                    // consumed even when walking, where it has nothing to step back from: an Escape the page lets
                    // through goes on to the window, where macOS can take it out of full screen
                    e.preventDefault();
                    office.back();
                    return;
                case "menu":
                    e.preventDefault();
                    office.toggleMenu();
                    return;
                case "desk":
                    e.preventDefault();
                    office.desk(act.delta);
                    return;
                case "nextAsk":
                    e.preventDefault();
                    office.nextAsk();
                    return;
                case "floor":
                    e.preventDefault();
                    office.floor(act.delta);
                    return;
                case "grab":
                    e.preventDefault();
                    office.grab();
                    return;
                case "slot":
                    e.preventDefault();
                    office.slot(act.dir);
                    return;
                case "drop":
                    e.preventDefault();
                    office.drop();
                    return;
                case "cancel":
                    e.preventDefault();
                    office.cancel();
                    return;
                case "tab": {
                    // the notice board's box pages between its rows (← → and h l); until the box is shown h l are
                    // left as they were
                    if (cursorId === BOARD_KEY && office.layer() === "dialog") {
                        e.preventDefault();
                        office.pageBoard(act.delta);
                        return;
                    }
                    // the lift's panel lists the floors in one column: ← → do nothing there, and leave the view alone
                    if (cursorId === LIFT_KEY && office.layer() === "dialog") {
                        e.preventDefault();
                        return;
                    }
                    // a question with several parts switches question (h l, and ← → in the dialog box)
                    const asker = askerAt(cursorId, roster, rowTargets);
                    const n = asker?.ask?.questions?.length ?? 0;
                    if (asker?.state === "asking" && n > 1) {
                        e.preventDefault();
                        const curTab = Math.min(answerTab[asker.id] ?? 0, n - 1);
                        selectQuestion(asker.id, Math.max(0, Math.min(n - 1, curTab + act.delta)));
                    }
                    return;
                }
                case "none":
                    e.preventDefault();
                    return;
                case "pass":
                    // r's composer lives on the card: show the card first, then the reply below opens it (a chord
                    // passes as it is)
                    if (key === "r" && !e.metaKey && !e.ctrlKey && !e.altKey && office.layer() !== "card") {
                        office.card();
                    }
                    break;
            }
        }
        // surface switch (`[`/`]`) now lives in the global keybinding registry (bindings.ts), so it
        // fires from every surface, not just the cockpit — see docs Pass A (F1/F2).
        // a run card can hold a lead the live list parked, so look the card up in the whole roster
        const cur = roster.find((a) => a.id === cursorId);
        const row = cursorId != null && isRowKey(cursorId) ? rowTargets[cursorId] : undefined;
        if (row && (/^[1-9]$/.test(key) || key === "Enter" || key === "t")) {
            e.preventDefault();
            // a worker is not a grid card, so look it up in the whole roster
            const asker = askerAt(cursorId, roster, rowTargets);
            if (/^[1-9]$/.test(key)) {
                const d = parseInt(key, 10);
                const target = asker ? answerDigitTarget(asker, answerTab[asker.id] ?? 0, d) : null;
                if (asker && target) {
                    toggleAnswer(asker.id, target.qi, target.oi);
                } else {
                    row.actions[d - 1]?.();
                }
            } else if (key === "Enter") {
                if (asker && canSubmitAsk(asker.ask?.questions ?? [], answerSel[asker.id] ?? {})) {
                    submitAnswer(asker.id);
                } else if (row.openId) {
                    openFocus(row.openId, false);
                }
            } else if (row.openId) {
                model.openTerminal(row.openId);
            }
            return;
        }
        if (key === "ArrowDown" || key === "j") {
            e.preventDefault();
            setCursorId((c) => moveCursor(navigableIds, c, 1));
        } else if (key === "ArrowUp" || key === "k") {
            e.preventDefault();
            setCursorId((c) => moveCursor(navigableIds, c, -1));
        } else if (key === "ArrowLeft" || key === "ArrowRight" || key === "h" || key === "l") {
            const back = key === "ArrowLeft" || key === "h";
            // a question with several parts keeps h/l for its tabs, on its own card or on its worker's task row
            const asker = askerAt(cursorId, roster, rowTargets);
            const n = asker?.ask?.questions?.length ?? 0;
            if (asker?.state === "asking" && n > 1) {
                e.preventDefault();
                const curTab = Math.min(answerTab[asker.id] ?? 0, n - 1);
                selectQuestion(asker.id, Math.max(0, Math.min(n - 1, curTab + (back ? -1 : 1))));
                return;
            }
            const target = columnJump(navCols, rowCardId, cursorId, back ? -1 : 1);
            if (target) {
                e.preventDefault();
                setCursorId(target);
            }
        } else if (key === "n") {
            e.preventDefault();
            const target = nextAskId(askTargets, lastJumpRef.current);
            if (target) {
                lastJumpRef.current = target;
                setCursorId(target);
                scrollToPulse(target);
            }
        } else if (key === "Enter") {
            e.preventDefault();
            if (!cur) return;
            if (cur.state === "asking" && canSubmitAsk(cur.ask?.questions ?? [], answerSel[cur.id] ?? {})) {
                submitAnswer(cur.id);
            } else {
                openFocus(cur.id, false);
            }
        } else if (key === " ") {
            if (cur) {
                e.preventDefault();
                void peekTarget(model, { kind: "agent", tabId: cur.id });
            }
        } else if (key === "r") {
            e.preventDefault();
            if (cur && !hasAnswerableAsk(cur)) {
                setOpenComposerId(cur.id);
                requestAnimationFrame(() => focusRowComposer(cur.id));
            }
        } else if (key === "t") {
            e.preventDefault();
            if (cur) {
                model.openTerminal(cur.id);
            }
        } else if (key === "b") {
            e.preventDefault();
            if (cur && cur.state !== "asking") {
                toggleBackground(cur.id);
            }
        } else if (/^[1-9]$/.test(key)) {
            if (cur) {
                const target = answerDigitTarget(cur, answerTab[cur.id] ?? 0, parseInt(key, 10));
                if (target) {
                    e.preventDefault();
                    toggleAnswer(cur.id, target.qi, target.oi);
                }
            }
        }
    };
}
