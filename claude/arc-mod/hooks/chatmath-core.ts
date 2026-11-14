// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// arcterm's Chat draws `$…$` and `$$…$$` with KaTeX (frontend/app/view/agents/markdownmessage.tsx). Claude writes for a
// terminal unless told, so a formula comes out as code; inside arcterm the mod tells it once per session, as a system
// prompt section where the prompt can be composed, else with the first prompt it submits.

export const MATH_SECTION_ID = "arc:chat-math";

export const MATH_SECTION =
    "Formulas in replies: arcterm's Chat renders LaTeX with KaTeX. Write math as `$…$` inline and `$$…$$` on lines of " +
    "their own for a display formula (e.g. `$\\hat p_h = c_h / n_h$`, `$$\\hat p = \\sum_h w_h \\hat p_h$$`), " +
    "not as inline code or a code block. Keep code, commands and identifiers in backticks. A dollar amount needs no " +
    "escaping when a digit or a space follows its `$`.";

export interface MathState {
    isActive: boolean;
    isInteractive: boolean;
    isCommand: boolean;
    isComposed: boolean;
    hasTold: boolean;
}

// the context the submitted prompt carries, or null: only inside arcterm, once, and only where the system prompt
// never took the section
export function mathContext(s: MathState): string | null {
    if (!s.isActive || !s.isInteractive || s.isCommand || s.isComposed || s.hasTold) {
        return null;
    }
    return MATH_SECTION;
}
