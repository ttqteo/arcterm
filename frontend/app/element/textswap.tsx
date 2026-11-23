// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MOTION } from "@/app/element/motiontokens";
import { motion } from "motion/react";
import { useState } from "react";
import { nextTextSwap, swapDelay, swapParts, type TextSwapState } from "./textswapmodel";

// TextSwap draws `text`, and when the text of the same `swapKey` changes, shows the new words in one after another
// (opacity only, the Fluid ease; the old text leaves at once, so two never overlap in a truncated line). The words are
// inline spans, so a `truncate` parent still ends the line with its ellipsis.
export function TextSwap({ text, swapKey }: { text: string; swapKey: string }) {
    const [shown, setShown] = useState<TextSwapState>({ key: swapKey, text, swap: 0 });
    const next = nextTextSwap(shown, swapKey, text);
    if (next !== shown) {
        // derived state, set during render: React re-renders at once with it, before anything paints
        setShown(next);
    }
    if (next.swap === 0) {
        return <>{text}</>;
    }
    const parts = swapParts(text);
    const words = parts.filter((p) => p.trim() !== "").length;
    let word = 0;
    return (
        <span key={next.swap} data-text-swap>
            {parts.map((p, i) => {
                if (p.trim() === "") {
                    return p;
                }
                const delay = swapDelay(word++, words);
                return (
                    <motion.span
                        key={i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: MOTION.durMacro, ease: MOTION.easeFluid, delay }}
                    >
                        {p}
                    </motion.span>
                );
            })}
        </span>
    );
}
