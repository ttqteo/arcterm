// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's one toast: bottom-centre over the surface, with Undo when the edit can be taken back.
// Brief-local rather than the cockpit's notificationstore, which is global and has no action button.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { briefToastAtom } from "./briefundo";

export function BriefToastView() {
    const toast = useAtomValue(briefToastAtom);
    if (toast == null) {
        return null;
    }
    return (
        <div
            role="status"
            data-jarvis-brief-toast={toast.error ? "error" : "info"}
            className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[9px] border border-edge-strong bg-surface-raised py-2 pl-3.5 pr-2.5 shadow-[0_12px_34px_var(--color-background)]"
        >
            <span className={cn("whitespace-nowrap text-[12.5px]", toast.error ? "text-error" : "text-secondary")}>
                {toast.text}
            </span>
            {toast.undo != null ? (
                <button
                    type="button"
                    data-jarvis-toast-undo
                    onClick={toast.undo}
                    className="cursor-pointer rounded-[6px] border border-edge-mid px-[9px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Undo
                </button>
            ) : null}
        </div>
    );
}
