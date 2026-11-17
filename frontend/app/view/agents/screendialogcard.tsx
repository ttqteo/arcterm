// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat's screen card: what Claude Code shows in its terminal that no other card answers (screendialog.ts has the
// rules). A numbered dialog no hook reports (the safeguards' "Session paused" menu) draws with its title, its text and
// a button per option, which types the option's number into the terminal; the card goes once the dialog leaves the
// screen. An option that puts the last prompt back in Claude Code's box ("Edit prompt and retry") takes it on into the
// chat box. Anything else the agent waits on there draws as the foot of the screen, with Answer in Terminal.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import { readTermLines } from "../term/termpaste";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { chatBoxText, focusChatBox, replaceChatBox } from "./chatinsert";
import { mergeTaken, takenBackOf } from "./chattakeback";
import { noteTakenBack, takeBackAfterKey } from "./chattakebackstore";
import { cardHead } from "./permissionmodel";
import { usePermission } from "./permissionstore";
import {
    dialogPickKeys,
    editsPrompt,
    lastPromptText,
    sameCard,
    sameDialog,
    screenCardOf,
    screenWatched,
    type ScreenCard,
} from "./screendialog";
import type { TuiDialog } from "./tuiscreen";

// the rows read off the bottom of the buffer: the whole screen, however tall. Claude Code 2.1.325 draws on the
// alternate screen from the top, so on a 52-row screen the safeguards' pause sat on rows 10 to 21 and a read of the
// bottom 40 missed its rule and title (tuiscreen.fixtures.json pausedDialog)
const DIALOG_SCREEN_ROWS = 200;
const DIALOG_POLL_MS = 1000;

const CARD = "rounded-[9px] border border-asking/45 bg-askingbg p-3";
const OPTION_BTN =
    "flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-[7px] border px-[12px] py-[6px] text-left text-[12.5px] font-semibold disabled:cursor-default disabled:opacity-50";
const CURSOR_BTN = "border-transparent bg-accent text-background hover:bg-accenthover";
const OTHER_BTN = "border-edge-mid bg-surface-raised text-muted hover:border-edge-strong hover:bg-surface-hover";
const TERMINAL_LINK = "cursor-pointer text-[12px] text-accent-soft hover:underline";

// The card the agent's screen calls for while `watch` holds, once two reads a second apart agree; null otherwise. Each
// read takes the agent's state as it is then (a ref), so a dialog on screen does not blink when the state changes under
// it (idle, then asking once wavesrv takes Claude Code's own report).
function useScreenCard(blockId: string | undefined, watch: boolean, state: string | undefined): ScreenCard | null {
    const [card, setCard] = useState<ScreenCard | null>(null);
    const stateRef = useRef(state);
    stateRef.current = state;
    useEffect(() => {
        setCard(null);
        if (!watch || blockId == null) {
            return;
        }
        let last: ScreenCard | null = null;
        const read = () => {
            const now = screenCardOf(readTermLines(blockId, DIALOG_SCREEN_ROWS), stateRef.current);
            setCard(sameCard(last, now) ? now : null);
            last = now;
        };
        read();
        const timer = setInterval(read, DIALOG_POLL_MS);
        return () => clearInterval(timer);
    }, [blockId, watch]);
    return card;
}

function CardHead({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-2 text-[12.5px]">
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-asking pulse-dot" />
            <span className="min-w-0 truncate font-semibold text-primary">{title}</span>
        </div>
    );
}

export function ScreenDialogCard({
    agent,
    entries,
    askShown,
    onOpenTerminal,
}: {
    agent: AgentVM;
    // the conversation as Chat holds it: the last prompt, for an option that puts it back to edit
    entries: readonly AgentEntry[];
    askShown: boolean;
    onOpenTerminal: () => void;
}) {
    const oref = agent.blockId != null ? `block:${agent.blockId}` : undefined;
    const head = cardHead(usePermission(oref), askShown);
    const watch = screenWatched(agent, head != null, agent.ask != null);
    const card = useScreenCard(agent.blockId, watch, agent.state);
    // the dialog a click answered: its buttons stay dead until the screen shows another
    const [sentFor, setSentFor] = useState<TuiDialog | null>(null);
    const blockid = agent.blockId;
    if (card == null || blockid == null) {
        return null;
    }
    if (card.kind === "terminal") {
        return (
            <div
                role="group"
                aria-label="Waiting in the terminal"
                data-screen-terminal-card={agent.id}
                className={CARD}
            >
                <CardHead title="Waiting on you in the terminal" />
                <div
                    data-screen-terminal-rows
                    className="mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-[7px] bg-surface-code px-3 py-2 font-mono text-[12px] leading-[1.5] text-primary"
                >
                    {card.rows.join("\n")}
                </div>
                <button
                    type="button"
                    data-screen-dialog-terminal
                    className={cn(TERMINAL_LINK, "mt-2")}
                    onClick={onOpenTerminal}
                >
                    Answer in Terminal
                </button>
            </div>
        );
    }
    const dialog = card.dialog;
    const sent = sameDialog(sentFor, dialog);
    const pick = (label: string, n: number) => {
        setSentFor(dialog);
        const key = dialogPickKeys(dialog, n);
        const prompt = editsPrompt(label) ? lastPromptText(entries) : null;
        if (prompt == null) {
            fireAndForget(() =>
                RpcApi.ControllerInputCommand(TabRpcClient, { blockid, inputdata64: stringToBase64(key) })
            );
            return;
        }
        // the record of the prompt stays in the transcript until the next prompt branches off it, as after an Esc
        const held = [...entries];
        fireAndForget(async () => {
            await takeBackAfterKey(agent.id, blockid, key, [prompt], (texts) => {
                noteTakenBack(agent.id, takenBackOf({ kind: "interrupt", ids: [], texts }, held, Date.now()));
                replaceChatBox(agent.id, mergeTaken(texts, chatBoxText(agent.id)));
                focusChatBox(agent.id);
            });
        });
    };
    return (
        <div role="group" aria-label={dialog.title} data-screen-dialog-card={agent.id} className={CARD}>
            <CardHead title={dialog.title} />
            {dialog.body.length > 0 && (
                <div
                    data-screen-dialog-body
                    className="mt-2 flex max-h-[180px] flex-col gap-1.5 overflow-auto text-[12.5px] leading-[1.5] text-secondary"
                >
                    {dialog.body.map((para, i) => (
                        <p key={i} className="m-0 whitespace-pre-wrap break-words">
                            {para}
                        </p>
                    ))}
                </div>
            )}
            <div className="mt-3 flex flex-col items-start gap-1.5">
                {dialog.options.map((o) => (
                    <button
                        key={o.n}
                        type="button"
                        data-screen-dialog-option={o.n}
                        disabled={sent}
                        title={
                            editsPrompt(o.label)
                                ? `Pick "${o.label}": your prompt comes back to this box`
                                : `Pick "${o.label}" in the terminal`
                        }
                        className={cn(OPTION_BTN, o.n === dialog.cursor ? CURSOR_BTN : OTHER_BTN)}
                        onClick={() => pick(o.label, o.n)}
                    >
                        {!dialog.plain && <span className="flex-none tabular-nums opacity-70">{o.n}.</span>}
                        <span className="min-w-0 break-words">{o.label}</span>
                    </button>
                ))}
            </div>
            <button
                type="button"
                data-screen-dialog-terminal
                className={cn(TERMINAL_LINK, "mt-2")}
                onClick={onOpenTerminal}
            >
                Answer in Terminal
            </button>
        </div>
    );
}
