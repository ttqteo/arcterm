// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Uploads section: the Attach button, then what was uploaded into this agent's terminal (the list
// is uploadslist.tsx). Keyed by the agent's terminal block id (uploadsstore.ts). The section is closed at 0 but stays
// openable (emptyOpenable, agentrailsections.ts), so Attach is reachable before the first upload.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { hasUnnumberedPaste, imagePasteNames, imagePasteNumbers } from "./imagepasteids";
import { imagePastesAtomFor } from "./livetranscriptatoms";
import { pickAndAttach } from "./uploadsingest";
import { UploadsList } from "./uploadslist";
import { updateUploads, uploadsAtom } from "./uploadsstore";

// how much of the transcript the rail reads for a paste's number, and for how long after the paste it keeps looking: the
// prompt is usually just behind, but the section may first render (opened, or the agent focused) a long turn later
const PASTE_TAIL_LINES = 1000;
const PASTE_LOOK_MS = 60 * 60 * 1000;
// the prompt reaches the transcript just after the hook that flips the agent to working
const PASTE_READ_DELAY_MS = 800;

export function UploadsSection({ agent, now }: { agent: AgentVM; now: number }) {
    const { blockId, transcriptPath } = agent;
    const stored = useAtomValue(uploadsAtom(blockId ?? ""));
    // a pasted image is named by the [Image #N] Claude Code gave it, read off the agent's transcript stream; the name is
    // written back to the store, so it outlives the stream's window and a reload
    const pastes = useAtomValue(imagePastesAtomFor(agent.id));
    const records = useMemo(() => (pastes ? imagePasteNames(stored, pastes) : stored), [stored, pastes]);
    useEffect(() => {
        if (blockId && pastes) {
            updateUploads(blockId, (list) => imagePasteNames(list, pastes));
        }
    }, [blockId, pastes]);
    // that stream is only open while the Cockpit surface shows, so the rail also reads the transcript's tail itself
    // while a paste is unnumbered, again each time the agent moves on (the prompt is in the transcript by then)
    const readKey =
        blockId && transcriptPath && hasUnnumberedPaste(stored, now - PASTE_LOOK_MS)
            ? `${transcriptPath}|${agent.state}|${agent.activity ?? ""}`
            : "";
    useEffect(() => {
        if (!readKey) {
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            fireAndForget(async () => {
                const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, {
                    path: transcriptPath!,
                    maxlines: PASTE_TAIL_LINES,
                }).catch((): null => null);
                if (!cancelled && rtn?.lines) {
                    const numbers = imagePasteNumbers(rtn.lines);
                    updateUploads(blockId!, (list) => imagePasteNames(list, numbers));
                }
            });
        }, PASTE_READ_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [readKey]);
    return (
        <div data-rail-uploads className="flex flex-col gap-[8px]">
            <button
                type="button"
                data-rail-attach
                disabled={!blockId}
                title={
                    blockId
                        ? "Pick files and insert their paths at this agent's prompt"
                        : "This agent has no terminal to attach to"
                }
                onClick={() => {
                    if (blockId) {
                        fireAndForget(() => pickAndAttach(blockId));
                    }
                }}
                className="inline-flex w-fit cursor-pointer items-center gap-[5px] rounded-[7px] border border-edge-mid px-[9px] py-[4px] text-[11px] font-semibold text-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
                <Plus size={12} aria-hidden />
                Attach
            </button>
            {records.length > 0 ? (
                // keyed by the terminal: Ctrl+Tab swaps the rail's agent while a lightbox is open, and the remount closes it
                // instead of leaving one agent's image over another's rail
                <UploadsList key={blockId} records={records} now={now} />
            ) : (
                <div className="text-[11.5px] text-muted">
                    {blockId
                        ? "Paste an image or drop files on the terminal, or attach them here."
                        : "This agent has no terminal to paste into or attach to."}
                </div>
            )}
        </div>
    );
}
