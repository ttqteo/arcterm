// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's step checklist: a ```arc-steps block in a Claude agent's reply draws as one list per turn, at the first block of
// the turn, showing the turn's latest block; the later blocks draw nothing where they stand. Where each turn's list goes
// and what it shows is decided by the pure model, chatsteplist.ts; this file is the host that hands those decisions to
// the blocks (ChatConversation provides it), the context that tells a block which prose part it is in, and the list.
// Outside a host (a council's messages) a block stays code.
// (docs/superpowers/specs/2026-11-13-chat-task-checklist-design.md)

import { MOTION, springReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
    STEPS_LANG,
    parseSteps,
    shownState,
    stepKeys,
    stepsKey,
    type PlacedSteps,
    type Step,
    type StepState,
    type StepsPhase,
} from "./chatsteplist";
import { CodeBlock } from "./codeblock";

// each prose part with a block: its turn's list when the list is drawn there, null when its blocks draw nothing
const StepsHostContext = createContext<ReadonlyMap<string, PlacedSteps | null> | null>(null);
const StepsPartContext = createContext<string | null>(null);

export function ChatStepsHost({
    placed,
    children,
}: {
    placed: ReadonlyMap<string, PlacedSteps | null>;
    children: ReactNode;
}) {
    return <StepsHostContext.Provider value={placed}>{children}</StepsHostContext.Provider>;
}

// the prose part the blocks under it sit in, keyed as placeStepLists keys it (stepsPartKey)
export function StepsPart({ partKey, children }: { partKey: string; children: ReactNode }) {
    return <StepsPartContext.Provider value={partKey}>{children}</StepsPartContext.Provider>;
}

// a ```arc-steps block: the turn's list where the model draws it, nothing for a later block of the turn, and code where
// there is no host or the block lists no step
export function StepsBlock({ raw }: { raw: string }) {
    const placed = useContext(StepsHostContext);
    const part = useContext(StepsPartContext);
    const steps = useMemo(() => parseSteps(raw), [raw]);
    if (placed == null || steps.length === 0) {
        return <CodeBlock code={raw} lang={STEPS_LANG} />;
    }
    // a block the model did not place (outside a prose part, or Markdown found it where the model's scan does not
    // look): its own steps, as a list that is over
    if (part == null || !placed.has(part)) {
        return <StepList steps={steps} phase="over" />;
    }
    const list = placed.get(part);
    if (list == null || list.anchor !== stepsKey(steps)) {
        return null;
    }
    return <StepList steps={list.steps} phase={list.phase} />;
}

const STATE_LABEL: Record<StepState, string> = { done: "Done", working: "In progress", pending: "Not started" };

function StepIcon({ state, pulse }: { state: StepState; pulse: boolean }) {
    if (state === "done") {
        return (
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="8" cy="8" r="6.5" />
                <path d="M5.2 8.2l2 2 3.6-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (state === "working") {
        return (
            // the pulse is pulsedriver's (pulse.ts), not a CSS animation: it writes this svg's opacity
            <svg
                viewBox="0 0 16 16"
                className={cn("h-4 w-4 text-working", pulse && "pulse-soft")}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
            >
                <circle cx="8" cy="8" r="6.5" />
                <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
            </svg>
        );
    }
    return (
        <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 text-ink-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="2.6 2.4"
        >
            <circle cx="8" cy="8" r="6.5" />
        </svg>
    );
}

const TEXT_CLASS: Record<StepState, string> = {
    done: "text-muted",
    working: "text-foreground",
    pending: "text-secondary",
};

const ICON_FADE = { duration: MOTION.durMicro, ease: MOTION.easeFluid };

function StepRow({ step, phase }: { step: Step; phase: StepsPhase }) {
    const state = shownState(step.state, phase);
    return (
        <div data-chat-step={state} className="flex items-start gap-2.5 py-1 text-[14px] leading-[1.45]">
            {/* the icons of two states crossfade, one over the other, in a fixed 16px cell */}
            <span role="img" aria-label={STATE_LABEL[state]} className="relative mt-px h-4 w-4 flex-none">
                <AnimatePresence initial={false}>
                    <motion.span
                        key={state}
                        className="absolute inset-0"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: ICON_FADE }}
                        exit={{ opacity: 0, transition: ICON_FADE }}
                    >
                        <StepIcon state={state} pulse={phase === "live"} />
                    </motion.span>
                </AnimatePresence>
            </span>
            <span className={cn("min-w-0 [overflow-wrap:anywhere]", TEXT_CLASS[state])}>{step.text}</span>
        </div>
    );
}

export function StepList({ steps, phase }: { steps: Step[]; phase: StepsPhase }) {
    const keys = stepKeys(steps);
    return (
        <div data-chat-steps={phase} className="my-2 flex flex-col rounded-lg border border-edge-mid px-3.5 py-1.5">
            {/* the list's first appearance takes no entrance of its own; a step added or removed later grows or folds */}
            <AnimatePresence initial={false}>
                {steps.map((step, i) => (
                    <motion.div
                        key={keys[i]}
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden"
                    >
                        <StepRow step={step} phase={phase} />
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
