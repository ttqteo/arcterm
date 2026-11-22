// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// arcterm's Chat draws `$…$` and `$$…$$` with KaTeX (frontend/app/view/agents/markdownmessage.tsx). Claude writes for a
// terminal unless told, so a formula comes out as code; inside arcterm the mod tells it once per session, as a system
// prompt section where the prompt can be composed, else with the first prompt it submits. The same section says Chat
// draws a ```mermaid block (zoomable, copyable as a picture): unasked, Claude drew a pipeline as ASCII arrows in a
// code block, which wrapped into a tangle at chat width. And it says to write a picture as `![](path)`: unasked, Claude
// named an annotated screenshot it made as a code-span path, a link to open, where the picture was the point.

export const MATH_SECTION_ID = "arc:chat-math";

export const MATH_SECTION =
    "Formulas in replies: arcterm's Chat renders LaTeX with KaTeX. Write math as `$…$` inline and `$$…$$` on lines of " +
    "their own for a display formula (e.g. `$\\hat p_h = c_h / n_h$`, `$$\\hat p = \\sum_h w_h \\hat p_h$$`), " +
    "not as inline code or a code block. Keep code, commands and identifiers in backticks. A dollar amount needs no " +
    "escaping when a digit or a space follows its `$`. Diagrams in replies: Chat draws a ```mermaid block (it can be " +
    "zoomed and copied as a picture), so a flow, pipeline, sequence, state or architecture diagram is a mermaid " +
    "block, never ASCII arrows or box art in a code block. A chart or widget mermaid cannot draw is the arc:visual " +
    "skill. Pictures in replies: to show the person an image file you made or annotated, write it as " +
    "`![what it shows](/full/path.png)` with its full path; Chat draws it in the reply.";

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
