// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The banner a "subject"-posture surface (Agent, Code, Radar) shows when what it is showing is not the app bar's
// project. A subject surface hides nothing, so it offers a rejoin rather than a reveal, and it renders nothing at all
// when aligned: the app bar already carries the answer, and silence is the reward for being in sync.

import { cn } from "@/util/util";
import { Crosshair } from "lucide-react";
import { divergenceText, type SubjectDecision } from "./focussubject";

export function DivergenceBanner({ decision, onRejoin }: { decision: SubjectDecision; onRejoin: () => void }) {
    if (decision.kind !== "diverged") {
        return null;
    }
    return (
        <div
            data-divergence-banner
            className="mx-1 mb-2 flex items-center gap-2.5 rounded-[8px] border border-edge-strong bg-surface py-1 pl-3 pr-1.5 text-[12.5px]"
        >
            <Crosshair size={14} strokeWidth={1.8} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-ink-mid">
                {divergenceText(decision.focus, decision.local)}
            </span>
            <button
                type="button"
                data-divergence-rejoin
                onClick={onRejoin}
                className={cn(
                    "shrink-0 cursor-pointer rounded-sm px-2 py-1 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    "text-accent-soft hover:text-accent-100"
                )}
            >
                Show the project
            </button>
        </div>
    );
}
