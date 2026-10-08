// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The refresh button of the Plan usage strip and the Usage surface: asks the usage endpoint now, past the
// poll's spacing. While it runs the icon spins and the button is disabled; a 429 backoff it cannot break
// is said for a few seconds as "retry at HH:MM". The visibility rule is in usagerefresh.ts.

import { cn } from "@/util/util";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { refreshClaudeQuota } from "./claudequota";
import { retryHint } from "./usagerefresh";

// how long a refused refresh keeps saying when to retry
const HINT_MS = 8000;

export function UsageRefreshButton({ className }: { className?: string }) {
    const [running, setRunning] = useState(false);
    const [hint, setHint] = useState("");
    const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (hintTimer.current != null) {
                clearTimeout(hintTimer.current);
            }
        },
        []
    );

    const refresh = async () => {
        if (running) {
            return;
        }
        setRunning(true);
        const result = await refreshClaudeQuota();
        setRunning(false);
        if (hintTimer.current != null) {
            clearTimeout(hintTimer.current);
        }
        setHint(result.retryAt != null ? retryHint(result.retryAt) : "");
        hintTimer.current = result.retryAt != null ? setTimeout(() => setHint(""), HINT_MS) : null;
    };

    return (
        <span className="flex flex-none items-center gap-1.5">
            {hint ? <span className="whitespace-nowrap text-[10.5px] tabular-nums text-warning">{hint}</span> : null}
            <button
                type="button"
                aria-label="Refresh usage"
                title={hint || "Refresh usage"}
                disabled={running}
                onClick={() => void refresh()}
                className={cn(
                    "flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded border border-edge-mid bg-transparent text-ink-mid hover:border-edge-strong hover:bg-surface-raised hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:border-edge-mid disabled:hover:bg-transparent disabled:hover:text-ink-mid",
                    className
                )}
            >
                <RefreshCw size={13} className={cn(running && "animate-spin motion-reduce:animate-none")} />
            </button>
        </span>
    );
}
