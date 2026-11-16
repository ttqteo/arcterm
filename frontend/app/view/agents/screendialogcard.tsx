// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat's screen dialog card: a dialog Claude Code shows in its terminal that no hook reports (the safeguards'
// "Session paused" menu), read off the screen and drawn with its title, its text and a button per option. A button types
// the option's number into the terminal; the card goes once the dialog leaves the screen. The rules are in
// screendialog.ts; the permission card and an ask's choices keep the dialogs they answer.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import { readTermLines } from "../term/termpaste";
import type { AgentVM } from "./agentsviewmodel";
import { cardHead } from "./permissionmodel";
import { usePermission } from "./permissionstore";
import { dialogPickKeys, sameDialog, screenDialogWanted } from "./screendialog";
import { tuiDialog, type TuiDialog } from "./tuiscreen";

// the rows read off the bottom of the screen: a long dialog's text with room to spare
const DIALOG_SCREEN_ROWS = 40;
const DIALOG_POLL_MS = 1000;

const OPTION_BTN =
    "flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-[7px] border px-[12px] py-[6px] text-left text-[12.5px] font-semibold disabled:cursor-default disabled:opacity-50";
const CURSOR_BTN = "border-transparent bg-accent text-background hover:bg-accenthover";
const OTHER_BTN = "border-edge-mid bg-surface-raised text-muted hover:border-edge-strong hover:bg-surface-hover";

// The dialog on the agent's screen while `watch` holds, once two reads a second apart agree; null otherwise.
function useScreenDialog(blockId: string | undefined, watch: boolean): TuiDialog | null {
    const [dialog, setDialog] = useState<TuiDialog | null>(null);
    useEffect(() => {
        setDialog(null);
        if (!watch || blockId == null) {
            return;
        }
        let last: TuiDialog | null = null;
        const read = () => {
            const lines = readTermLines(blockId, DIALOG_SCREEN_ROWS);
            const now = lines == null ? null : tuiDialog(lines);
            setDialog(sameDialog(last, now) ? now : null);
            last = now;
        };
        read();
        const timer = setInterval(read, DIALOG_POLL_MS);
        return () => clearInterval(timer);
    }, [blockId, watch]);
    return dialog;
}

export function ScreenDialogCard({
    agent,
    askShown,
    onOpenTerminal,
}: {
    agent: AgentVM;
    askShown: boolean;
    onOpenTerminal: () => void;
}) {
    const oref = agent.blockId != null ? `block:${agent.blockId}` : undefined;
    const head = cardHead(usePermission(oref), askShown);
    const watch = screenDialogWanted(agent, head != null, askShown);
    const dialog = useScreenDialog(agent.blockId, watch);
    // the dialog a click answered: its buttons stay dead until the screen shows another
    const [sentFor, setSentFor] = useState<TuiDialog | null>(null);
    const sent = sameDialog(sentFor, dialog);
    const blockRef = useRef(agent.blockId);
    blockRef.current = agent.blockId;
    if (dialog == null || agent.blockId == null) {
        return null;
    }
    const pick = (n: number) => {
        const blockid = blockRef.current;
        if (blockid == null) {
            return;
        }
        setSentFor(dialog);
        fireAndForget(() =>
            RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid,
                inputdata64: stringToBase64(dialogPickKeys(dialog, n)),
            })
        );
    };
    return (
        <div
            role="group"
            aria-label={dialog.title}
            data-screen-dialog-card={agent.id}
            className="rounded-[9px] border border-asking/45 bg-askingbg p-3"
        >
            <div className="flex items-center gap-2 text-[12.5px]">
                <span className="h-[7px] w-[7px] flex-none rounded-full bg-asking pulse-dot" />
                <span className="min-w-0 truncate font-semibold text-primary">{dialog.title}</span>
            </div>
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
                        title={`Pick "${o.label}" in the terminal`}
                        className={cn(OPTION_BTN, o.n === dialog.cursor ? CURSOR_BTN : OTHER_BTN)}
                        onClick={() => pick(o.n)}
                    >
                        <span className="flex-none tabular-nums opacity-70">{o.n}.</span>
                        <span className="min-w-0 break-words">{o.label}</span>
                    </button>
                ))}
            </div>
            <div className="mt-2">
                <button
                    type="button"
                    data-screen-dialog-terminal
                    className="cursor-pointer text-[12px] text-accent-soft hover:underline"
                    onClick={onOpenTerminal}
                >
                    Answer in Terminal
                </button>
            </div>
        </div>
    );
}
