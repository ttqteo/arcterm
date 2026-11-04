// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A council's details (councilDetails): the mode in a word and why it was picked, the clock, the replies and the tokens.
// They live at the foot of the Discussion's Ideas rail (CouncilDetailsFoot, on every tab of it), and in the header's
// details icon (CouncilDetailsIcon) wherever no rail shows them: the rail folded, Sources in its place, round 1's cards,
// the pause, the Map. One place at a time (railHoldsDetails), so `data-council-mode` and `data-council-cost`, which the
// scenarios read, are never on screen twice. The cost line is a screen reader's in one sr-only span; the figures drawn
// beside their icons are hidden from it. Kept apart from councilheader.tsx so the rail (councilchat.tsx) imports it
// without a cycle through the seats.

import { cn } from "@/util/util";
import { Clock, Coins, Info, MessageSquare, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { councilDetails } from "./councildiscussionmodel";

// the clock ticks each second while the council runs, and stands still otherwise
function useCouncilNow(running: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!running) {
            return;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [running]);
    return now;
}

/** The header's details icon: every detail in its tooltip, for where no rail shows them. */
export function CouncilDetailsIcon({ c }: { c: Council }) {
    const now = useCouncilNow(c.state === "running");
    const d = councilDetails(c, now);
    const lines = [d.why !== "" ? `${d.mode}: ${d.why}` : d.mode, d.line].filter((line) => line !== "");
    return (
        <span
            data-council-details
            role="note"
            tabIndex={0}
            title={lines.join("\n")}
            className="flex flex-none cursor-default items-center justify-center rounded-[6px] border border-transparent p-[5px] text-muted outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
        >
            <Info size={15} strokeWidth={1.8} aria-hidden />
            <span data-council-mode className="sr-only">
                {d.mode}
            </span>
            {d.line !== "" && (
                <span data-council-cost className="sr-only">
                    {d.line}
                </span>
            )}
        </span>
    );
}

// one figure beside its icon, its whole words on hover
function Figure({ icon: Icon, text, title }: { icon: typeof Clock; text: string; title: string }) {
    return (
        <span aria-hidden title={title} className="inline-flex items-center gap-1">
            <Icon size={12} strokeWidth={2} />
            {text}
        </span>
    );
}

/** The foot of the Ideas rail: the mode (why it was picked on hover), then the clock, the replies and the tokens. */
export function CouncilDetailsFoot({ c }: { c: Council }) {
    const now = useCouncilNow(c.state === "running");
    const d = councilDetails(c, now);
    return (
        <footer
            data-council-rail-details
            aria-label="Council details"
            className="flex h-[38px] flex-none items-center gap-3 whitespace-nowrap border-t border-border px-6 text-[12px] tabular-nums text-muted"
        >
            <span
                tabIndex={d.why !== "" ? 0 : undefined}
                title={d.why !== "" ? `${d.mode}: ${d.why}` : d.mode}
                className={cn(
                    "inline-flex min-w-0 items-center gap-[5px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    d.why !== "" &&
                        "cursor-help underline decoration-edge-strong decoration-dotted underline-offset-[3px]"
                )}
            >
                <Scale size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
                <span data-council-mode>{d.mode}</span>
            </span>
            <span className="flex-1" />
            {d.clock !== "" && <Figure icon={Clock} text={d.clock} title={`${d.clock} since the council started`} />}
            {d.replies !== "" && <Figure icon={MessageSquare} text={d.replies} title={d.replies} />}
            {d.tokens !== "" && <Figure icon={Coins} text={d.tokens} title={d.tokens} />}
            {d.line !== "" && (
                <span data-council-cost className="sr-only">
                    {d.line}
                </span>
            )}
        </footer>
    );
}
