// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Uploads section. For now only its shape: the empty state and the Attach slot the uploads work
// (paste, drop, Attach) fills, so the rail already lists Uploads between Artifacts and Background tasks.

import { Plus } from "lucide-react";

export function UploadsSection() {
    return (
        <div data-rail-uploads className="flex flex-col gap-[8px]">
            <div className="text-[11.5px] text-muted">Nothing attached yet</div>
            <button
                type="button"
                data-rail-attach
                disabled
                title="Attach files"
                className="inline-flex w-fit items-center gap-[5px] rounded-[7px] border border-edge-mid px-[9px] py-[4px] text-[11px] font-semibold text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
            >
                <Plus size={12} aria-hidden />
                Attach
            </button>
        </div>
    );
}
