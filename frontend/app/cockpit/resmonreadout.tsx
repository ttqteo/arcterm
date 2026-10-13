// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Resource Manager's footer readout: Arc's whole CPU and memory at a glance, and the door to the popover.
// Drawn in the global footer and in the Cockpit's own hints bar, so the popover anchors to whichever was clicked.

import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Activity } from "lucide-react";
import { readout } from "./resmon";
import { resmonOpenAtom, resmonSnapshotAtom } from "./resmonstore";

let opener: HTMLElement | null = null;

// the readout that opened the popover, while it is still on screen
export function resmonOpener(): HTMLElement | null {
    return opener?.isConnected ? opener : null;
}

export function ResMonReadout({ className }: { className?: string }) {
    const snap = useAtomValue(resmonSnapshotAtom);
    const [open, setOpen] = useAtom(resmonOpenAtom);
    const r = readout(snap);
    if (!r.visible) {
        return null;
    }
    const busy = r.ready && r.busy != null;
    return (
        <button
            type="button"
            data-resmon-readout=""
            aria-label={r.aria}
            aria-expanded={open}
            onClick={(e) => {
                opener = e.currentTarget;
                setOpen(!open);
            }}
            className={cn(
                "flex h-5 shrink-0 cursor-pointer items-center gap-[7px] rounded-[5px] border px-2 text-[12px] focus-visible:outline focus-visible:outline-accent",
                className,
                busy
                    ? "border-warning bg-warning/12 text-warning-soft"
                    : open
                      ? "border-accent bg-accentbg text-secondary"
                      : "border-edge-mid text-secondary hover:border-edge-strong"
            )}
        >
            <Activity
                size={13}
                strokeWidth={2}
                aria-hidden
                className={busy ? "text-warning" : r.ready ? "text-ink-mid" : "text-ink-faint"}
            />
            {r.ready ? (
                <>
                    <span className={busy ? undefined : "text-muted"}>Arc</span>
                    <span className={cn("font-mono", !busy && "text-primary")}>{r.cpu}</span>
                    <span className={busy ? undefined : "text-muted"}>CPU</span>
                    <span className={busy ? "text-warning" : "text-ink-faint"}>·</span>
                    <span className={cn("font-mono", !busy && "text-primary")}>{r.mem}</span>
                    {busy && <span className="font-semibold text-warning">{r.busy}</span>}
                </>
            ) : (
                <span className="text-muted">
                    Arc <span className="font-mono">–</span>
                </span>
            )}
        </button>
    );
}
