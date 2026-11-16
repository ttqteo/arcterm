// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The "Wrong project?" band (docs/superpowers/specs/2026-11-16-jarvis-no-folder-ask-design.md 2b, D11): one line under an
// agent's header, for an agent Jarvis handed a job to from the pet's Ask. It says which project Jarvis chose and why, and
// "Wrong project?" opens, in place, the same rows the chooser card has; picking one moves the job there
// (jarvisroutestore.ts rerouteAgent). It goes when the person closes it, types into the agent (agentsurface.tsx) or moves
// the job. The line it says is jarvisroutebandmodel.ts; this file draws it and holds the list's open state.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { allProjectChoices, type RouteChoice } from "@/app/view/jarvis/jarvisroute";
import { RouteChoiceList } from "@/app/view/jarvis/jarvisroutechoices";
import { dismissRouteBand, jarvisRouteBandAtom, rerouteAgent, routeWorld } from "@/app/view/jarvis/jarvisroutestore";
import { useAtomValue } from "jotai";
import { Route, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { routeBandLine } from "./jarvisroutebandmodel";

// the project list scrolls past this height (px), so a long roster never pushes the terminal off the surface
const LIST_MAX_H = 168;

const BAND_BTN =
    "inline-flex h-[25px] shrink-0 cursor-pointer items-center rounded-[6px] border border-accent/45 bg-transparent px-2.5 text-[11.5px] font-semibold text-accent-soft hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function JarvisRouteBand({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const band = useAtomValue(jarvisRouteBandAtom)[agent.id];
    // the list is open for one band: a job that arrives later for the same agent is a new note, so it starts closed
    const [openFor, setOpenFor] = useState<object | null>(null);
    const [choices, setChoices] = useState<RouteChoice[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    // which read of the world the list waits for; closing or opening again makes an older read's answer stale
    const read = useRef(0);
    const part = usePartMotion(springReveal);

    if (band == null) {
        return null;
    }
    const open = openFor === band;
    const line = routeBandLine(band);

    const toggle = () => {
        const mine = ++read.current;
        if (open) {
            setOpenFor(null);
            return;
        }
        setOpenFor(band);
        setChoices(null);
        setLoadError(null);
        // read fresh at each opening: a project may have been added since the job went out
        routeWorld(model).then(
            (world) => {
                if (read.current === mine) {
                    setChoices(allProjectChoices(world));
                }
            },
            (e: unknown) => {
                if (read.current === mine) {
                    setLoadError(e instanceof Error ? e.message : String(e));
                }
            }
        );
    };

    return (
        <div
            data-jarvis-route-band={agent.id}
            className="mx-1 mb-2 flex shrink-0 flex-col rounded-md border border-edge-mid bg-surface-raised text-[12px] text-secondary"
        >
            <div className="flex items-center gap-2 px-3 py-[6px]">
                <Route size={13} strokeWidth={1.8} aria-hidden className="shrink-0 text-accent-soft" />
                <span data-route-band-line title={line} className="min-w-0 flex-1 truncate">
                    {line}
                </span>
                <button
                    type="button"
                    data-route-band-wrong
                    aria-expanded={open}
                    onClick={toggle}
                    title="Hand this job to another project"
                    className={BAND_BTN}
                >
                    Wrong project?
                </button>
                <button
                    type="button"
                    data-route-band-dismiss
                    aria-label="Dismiss"
                    title="Dismiss"
                    onClick={() => dismissRouteBand(agent.id)}
                    className="flex size-[22px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <X size={14} strokeWidth={1.8} aria-hidden />
                </button>
            </div>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div {...part} key="list" className="overflow-hidden">
                        <div
                            data-route-band-list
                            style={{ maxHeight: LIST_MAX_H }}
                            className="overflow-y-auto border-t border-edge-mid px-2 py-2"
                        >
                            {choices != null ? (
                                <RouteChoiceList
                                    choices={choices}
                                    onPick={(choice) => rerouteAgent(model, agent.id, choice.project)}
                                />
                            ) : loadError != null ? (
                                <p
                                    role="alert"
                                    data-route-band-error
                                    className="text-[11px] text-error [overflow-wrap:anywhere]"
                                >
                                    {loadError}
                                </p>
                            ) : (
                                <p className="text-[11px] text-muted">Reading the projects…</p>
                            )}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
