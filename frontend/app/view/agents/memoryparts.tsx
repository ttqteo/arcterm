// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The pieces the Memory tab's two views share: the table view (setupmemory.tsx) and the card view
// (memorycard.tsx) both draw a change's kind chip, diffs, conflict alert and check button from here, so
// neither view imports the other's components.

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useReducedMotion, type Variants } from "motion/react";
import { checkNowBlocked, kindLabel, kindTone, type KindTone } from "./memorymodel";
import { checkMemory, memoryBusyAtom } from "./memorystore";
import { PathTail } from "./pathtail";
import { fmtClock } from "./runcompletion";
import type { Tone } from "./setupmodel";

export const SECTION_HEAD = cn(REGION_LABEL, "text-muted");
export const BTN_SECONDARY =
    "h-8 flex-none cursor-pointer rounded border border-edge-mid bg-surface-raised px-3 text-[13px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";
export const BTN_PRIMARY =
    "h-8 cursor-pointer rounded border-0 bg-accent px-[14px] text-[13px] font-bold text-background shadow-inset-highlight hover:bg-accenthover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent";
const KIND_CHIP =
    "inline-flex h-[22px] items-center whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold";
// a removal reads apart from what comes in and from an edit in place
const KIND_TONE: Record<KindTone, string> = {
    remove: "border-error/30 bg-error/10 text-error-soft",
    add: "border-accent/30 bg-accentbg text-accent-soft",
    edit: "border-edge-mid bg-surface-hover text-ink-mid",
};

const TONE_DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", none: "bg-ink-faint" };
export const TONE_TEXT: Record<Tone, string> = { ok: "text-ink-mid", warn: "text-warning-soft", none: "text-muted" };

const DIFF_LINE: Record<string, string> = {
    "-": "bg-diff-removed/10 text-diff-removed",
    "+": "bg-diff-added/10 text-diff-added",
};

export function toTone(s: string): Tone {
    return s === "ok" || s === "warn" ? s : "none";
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
    return <span className={cn("h-1.5 w-1.5 flex-none rounded-full", TONE_DOT[tone], className)} />;
}

// the props of a motion element that fades in on mount (and out on exit, when it leaves under AnimatePresence).
// MotionConfig's reduced-motion pass drops transform and layout animation but keeps opacity, so a fade is
// dropped here: under reduced motion the element just appears.
interface FadeProps {
    variants?: Variants;
    initial?: string;
    animate?: string;
    exit?: string;
}

export function useFade(): (variants: Variants, leaves?: boolean) => FadeProps {
    const reduce = useReducedMotion();
    return (variants, leaves = false) =>
        reduce ? {} : { variants, initial: "initial", animate: "animate", ...(leaves ? { exit: "exit" } : {}) };
}

export function KindChip({ p, change }: { p: MemHygieneProject; change: MemChange }) {
    return (
        <span data-memory-kind={kindTone(change.kind)} className={cn(KIND_CHIP, KIND_TONE[kindTone(change.kind)])}>
            {kindLabel(p, change)}
        </span>
    );
}

export function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

// Check now and Check again: the spin and label carry a running check, which the disabled state alone did
// not. a check with nothing new ends before a list can read it running; the result note covers that one.
// an Ask an agent running or queued holds it: the check would race the ask's state write.
export function CheckButton({
    p,
    label,
    className,
    marked,
}: {
    p: MemHygieneProject;
    label: string;
    className?: string;
    marked?: boolean;
}) {
    // busy also covers a decision in flight, which disables the button but is not a check
    const busy = useAtomValue(memoryBusyAtom);
    const blocked = checkNowBlocked(p, Date.now());
    return (
        // the title sits on a wrapper: a disabled button gets no pointer events to show its own
        <span title={blocked ?? undefined} className="inline-flex flex-none">
            <button
                type="button"
                data-memory-check={marked || undefined}
                data-memory-check-blocked={blocked != null || undefined}
                disabled={busy || p.checking || blocked != null}
                onClick={() => fireAndForget(() => checkMemory(p.project))}
                className={cn(BTN_SECONDARY, "inline-flex items-center gap-1.5", className)}
            >
                <RefreshCw size={13} className={cn(p.checking && "animate-spin motion-reduce:animate-none")} />
                {p.checking ? "Checking…" : label}
            </button>
        </span>
    );
}

export function ConflictAlert({ p, change }: { p: MemHygieneProject; change: MemChange }) {
    const what = change.conflictfile ? baseName(change.conflictfile) : "A file this change touches";
    return (
        <div
            role="alert"
            data-memory-conflict
            className="flex flex-col gap-2.5 rounded border border-warning/30 bg-warning/10 px-3.5 py-2.5"
        >
            <span className="flex gap-2 text-[12.5px] leading-[1.5] text-secondary">
                <TriangleAlert size={16} strokeWidth={2} className="mt-0.5 flex-none text-warning" />
                <span>
                    <span className="font-semibold text-warning-soft">Changed on disk since the check.</span> {what}{" "}
                    changed after Arc checked it at {fmtClock(p.checkedat)}. Check it again before applying.
                </span>
            </span>
            <span>
                <CheckButton p={p} label="Check again" className="h-[30px] text-[12.5px]" />
            </span>
        </div>
    );
}

export function DiffBlock({ diff }: { diff: MemDiff }) {
    return (
        <div className="overflow-hidden rounded border border-edge-mid bg-surface-code">
            <div className="flex h-7 items-center gap-2.5 border-b border-edge-faint px-2.5 font-mono text-[11px] text-muted">
                <PathTail path={diff.path} className="font-mono text-[11px]" />
                <span className="flex-1" />
                <span className="flex-none">{diff.note}</span>
            </div>
            {diff.lines?.length ? (
                <div className="py-1.5">
                    {diff.lines.map((ln, i) => (
                        <div
                            key={i}
                            className={cn(
                                "flex gap-2 px-2.5 py-px font-mono text-[11.5px] leading-[18px]",
                                DIFF_LINE[ln.sign] ?? "text-ink-mid"
                            )}
                        >
                            <span className="w-2 flex-none">{ln.sign}</span>
                            <span className="whitespace-pre-wrap break-words">{ln.text}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
