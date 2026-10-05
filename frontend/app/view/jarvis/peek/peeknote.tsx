// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { MarkdownMessage } from "@/app/view/agents/markdownmessage";
import { cn } from "@/util/util";
import { useEffect, useState } from "react";
import { REGION_LABEL } from "../briefstyle";
import { kindNoun } from "../peekitemmodel";
import { reportPeekFacts, type PeekTarget } from "../peekstore";
import { noteMetaLine, notePeekFacts } from "./peeknotemodel";

export function PeekNoteBody({ target }: { model: AgentsViewModel; target: PeekTarget }) {
    const noteId = target.kind === "note" ? target.noteId : "";
    const [note, setNote] = useState<CommandReadVaultNoteRtnData | null>(null);
    useEffect(() => {
        let live = true;
        RpcApi.ReadVaultNoteCommand(TabRpcClient, { id: noteId }).then(
            (rtn) => {
                if (live) {
                    setNote(rtn);
                    reportPeekFacts(target, notePeekFacts("ok"));
                }
            },
            () => {
                if (live) {
                    reportPeekFacts(target, notePeekFacts("error"));
                }
            }
        );
        return () => {
            live = false;
        };
    }, [target, noteId]);
    if (note == null) {
        return null;
    }
    const meta = noteMetaLine(note);
    return (
        <>
            <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
                <span className={cn(REGION_LABEL, "text-accent-soft")}>{kindNoun("note")}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-primary">{note.title}</span>
                {meta ? <span className="flex-none text-[10.5px] tabular-nums text-muted">{meta}</span> : null}
            </div>
            <div className="px-3.5 py-3">
                <MarkdownMessage text={note.body} className="text-[13px] leading-[1.6] text-secondary" />
            </div>
        </>
    );
}
