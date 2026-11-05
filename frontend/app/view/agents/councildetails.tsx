// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A council's details (councilDetails): the mode in a word and why it was picked, the clock, the replies and the tokens.
// They live at the foot of the Discussion's Ideas rail (CouncilDetailsFoot, on every tab of it) and in the Report's header
// row, after its status chip (CouncilDetailsLine); the Discussion's and the Map's header rows carry none. The two are
// never on screen at once (the Report has no rail), so `data-council-mode` and `data-council-cost`, which the scenarios
// read, show once. The cost line is a screen reader's in one sr-only span; the figures drawn beside their icons are
// hidden from it. Kept apart from councilheader.tsx so the rail (councilchat.tsx) imports it without a cycle through the
// seats.

import { cn } from "@/util/util";
import { Clock, Coins, MessageSquare, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { councilDetails, type CouncilDetails } from "./councildiscussionmodel";

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

// one figure beside its icon, its whole words on hover
function Figure({
    icon: Icon,
    text,
    title,
    className,
}: {
    icon: typeof Clock;
    text: string;
    title: string;
    className?: string;
}) {
    return (
        <span aria-hidden title={title} className={cn("inline-flex items-center gap-1", className)}>
            <Icon size={12} strokeWidth={2} />
            {text}
        </span>
    );
}

// the mode in a word, why it was picked on hover (dotted while there is a why)
function ModeWord({ d }: { d: CouncilDetails }) {
    return (
        <span
            tabIndex={d.why !== "" ? 0 : undefined}
            title={d.why !== "" ? `${d.mode}: ${d.why}` : d.mode}
            className={cn(
                "inline-flex min-w-0 items-center gap-[5px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent",
                d.why !== "" && "cursor-help underline decoration-edge-strong decoration-dotted underline-offset-[3px]"
            )}
        >
            <Scale size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
            <span data-council-mode>{d.mode}</span>
        </span>
    );
}

// what a screen reader hears for the figures, which are hidden from it
function CostLine({ d }: { d: CouncilDetails }) {
    return d.line !== "" ? (
        <span data-council-cost className="sr-only">
            {d.line}
        </span>
    ) : null;
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
            <ModeWord d={d} />
            <span className="flex-1" />
            {d.clock !== "" && <Figure icon={Clock} text={d.clock} title={`${d.clock} since the council started`} />}
            {d.replies !== "" && <Figure icon={MessageSquare} text={d.replies} title={d.replies} />}
            {d.tokens !== "" && <Figure icon={Coins} text={d.tokens} title={d.tokens} />}
            <CostLine d={d} />
        </footer>
    );
}

/** The Report header's details, after its status chip: the mode, the clock, the replies and the tokens in one line. A
 *  narrow pane keeps the mode and the clock (the glance under the header still shows the tokens), and a very narrow one
 *  none: the title and the controls keep the row. The row's container (`@container`) is the header. */
export function CouncilDetailsLine({ c }: { c: Council }) {
    const now = useCouncilNow(c.state === "running");
    const d = councilDetails(c, now);
    return (
        <span
            data-council-details
            className="flex flex-none items-center gap-3 whitespace-nowrap text-[12px] tabular-nums text-muted @max-[700px]:hidden"
        >
            <ModeWord d={d} />
            {d.clock !== "" && <Figure icon={Clock} text={d.clock} title={`${d.clock} since the council started`} />}
            {d.replies !== "" && (
                <Figure icon={MessageSquare} text={d.replies} title={d.replies} className="@max-[900px]:hidden" />
            )}
            {d.tokens !== "" && (
                <Figure icon={Coins} text={d.tokens} title={d.tokens} className="@max-[900px]:hidden" />
            )}
            <CostLine d={d} />
        </span>
    );
}
