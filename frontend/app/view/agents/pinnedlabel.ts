// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Chat's pinned bar (pinnedpromptbar.tsx) says of a message of yours. Pure.

import { splitAttachments } from "./chatfiles";
import { foldCommandParts, splitTagged, tagHeading, type TagPart } from "./chattagblocks";

/** Pure: what the pinned bar says of your message: its text, else the first tagged block it carried named as its card is
 *  ("Pasted · 12 lines"). The blocks themselves are not read out: a pasted log would fill the bar. null for a message
 *  that says nothing (only pictures or files): it is no pin, so the bar keeps the last message that does, where a
 *  "(picture)" told nothing of the conversation. */
export function pinnedLabel(text: string): string | null {
    const said = splitAttachments(text);
    if (said.text.trim() === "") {
        return null;
    }
    const parts = foldCommandParts(splitTagged(said.text.trim()));
    const block = parts.find((p): p is TagPart => p.kind === "tag");
    if (block == null) {
        return said.text;
    }
    const prose = parts
        .flatMap((p) => (p.kind === "text" ? [p.text] : []))
        .join("\n")
        .trim();
    return prose !== "" ? prose : tagHeading(block);
}
