// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The creature in float mode: a still Sprout in the float bar wearing what waits on you (petfloat.ts), which opens the
// peek below it. The peek is mounted whether or not the Sprout shows, so `g` `w` still opens it while floating.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { openPetPeek } from "./peekstore";
import { postureFor, postureLine } from "./petcondition";
import { floatMarkSprite } from "./petfloat";
import { petOutfit, petOutfitChoice } from "./petoutfit";
import { PetPeek } from "./petpeek";
import { PET_GRID, type PetCell } from "./petsprite";
import { petOutfitChoiceAtom } from "./petstore";
import { usePetSignals } from "./petview";

// two px a cell: 32px stands inside the 46px bar
const CELL_PX = 2;
const SPROUT_PX = PET_GRID * CELL_PX;

function cellRect(c: PetCell, i: number) {
    return (
        <rect key={i} x={c.x * CELL_PX} y={c.y * CELL_PX} width={CELL_PX} height={CELL_PX} fill={`var(${c.token})`} />
    );
}

export function PetFloatMark({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const posture = postureFor(signals);
    const outfit = petOutfit(petOutfitChoice(useAtomValue(petOutfitChoiceAtom)), new Date());
    const sprite = floatMarkSprite(posture, outfit);
    // state, not a ref: the peek positions itself once this lands
    const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
    const label = postureLine(posture);

    return (
        <span ref={setAnchor} data-pet-float className="flex shrink-0 items-center">
            {sprite != null ? (
                <button
                    type="button"
                    data-pet-float-mark={posture}
                    aria-label={label}
                    title={label}
                    onClick={() => openPetPeek()}
                    className="cursor-pointer rounded-[7px] px-1 py-[3px] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <svg width={SPROUT_PX} height={SPROUT_PX} viewBox={`0 0 ${SPROUT_PX} ${SPROUT_PX}`} aria-hidden>
                        {sprite.back.map(cellRect)}
                        {sprite.body.map(cellRect)}
                        {sprite.overlay.map(cellRect)}
                    </svg>
                </button>
            ) : null}
            <PetPeek model={model} anchor={anchor} corner="top-right" signals={signals} />
        </span>
    );
}
