// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Uploads section: the Attach button, then what was uploaded into this agent's terminal (the list
// is uploadslist.tsx). Keyed by the agent's terminal block id (uploadsstore.ts). The section is closed at 0 but stays
// openable (emptyOpenable, agentrailsections.ts), so Attach is reachable before the first upload.

import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { pickAndAttach } from "./uploadsingest";
import { UploadsList } from "./uploadslist";
import { uploadsAtom } from "./uploadsstore";

export function UploadsSection({ blockId, now }: { blockId: string | undefined; now: number }) {
    const records = useAtomValue(uploadsAtom(blockId ?? ""));
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
                <UploadsList records={records} now={now} />
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
