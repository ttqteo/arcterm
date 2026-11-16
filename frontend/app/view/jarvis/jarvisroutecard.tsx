// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chooser card of the Ask at No folder: Jarvis is not sure which project (or which of its agents) a job belongs to,
// so it says why in one line and lists the choices, each one a row to press (docs/superpowers/specs/
// 2026-11-16-jarvis-no-folder-ask-design.md, section 7 and D5). The card is petRouteCardAtom drawn; the rows are the
// shared RouteChoiceList, which also draws the "Wrong project?" band's, and a pick is carried out by jarvisroutestore.ts.
//
// It sits above the reply in the Ask box and is bounded like the reply is: its rows scroll inside it, so a long list of
// projects never grows the popover.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { RouteChoiceList } from "./jarvisroutechoices";
import { pickRouteChoice } from "./jarvisroutestore";
import { petRouteCardAtom, type PetRouteCard } from "./petstore";

export function RouteCard({ model, card }: { model: AgentsViewModel; card: PetRouteCard }) {
    const part = usePartMotion(springReveal);
    return (
        <motion.div
            {...part}
            data-pet-route-card
            className="relative overflow-hidden rounded-[8px] border border-border bg-background px-[9px] py-[7px]"
        >
            <div className="flex items-start gap-1.5">
                {/* one sentence by the model's own brief, but a long one scrolls rather than grows the popover */}
                <p className="max-h-[66px] min-w-0 flex-1 overflow-y-auto text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">
                    {card.why}
                </p>
                <button
                    type="button"
                    data-pet-route-card-dismiss
                    aria-label="Dismiss choices"
                    onClick={() => globalStore.set(petRouteCardAtom, null)}
                    className="-my-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <X aria-hidden="true" size={12} strokeWidth={2} />
                </button>
            </div>
            <div className="mt-1.5 max-h-[180px] overflow-y-auto">
                <RouteChoiceList
                    choices={card.choices}
                    onPick={(choice) => pickRouteChoice(model, choice, card.task)}
                />
            </div>
        </motion.div>
    );
}
