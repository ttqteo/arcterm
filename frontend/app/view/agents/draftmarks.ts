// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agents whose chat box holds a message you have not sent: text typed (wakingstore.ts wakeDraftsAtom, which keeps
// it per agent once you leave the box) or a file still attached (composerattachments.ts attachmentDraftsAtom). The
// Agent tree marks their rows (agenttree.tsx DraftMark), so a message you stopped writing half way is found again.

import { atom } from "jotai";
import { attachmentDraftsAtom, type Attachment } from "./composerattachments";
import { wakeDraftsAtom } from "./wakingstore";

/** Pure: the ids with a draft: text that is more than blank, or one attachment or more. */
export function draftIds(
    texts: ReadonlyMap<string, string>,
    attachments: ReadonlyMap<string, readonly Attachment[]>
): ReadonlySet<string> {
    const out = new Set<string>();
    for (const [id, text] of texts) {
        if (text.trim() !== "") {
            out.add(id);
        }
    }
    for (const [id, list] of attachments) {
        if (list.length > 0) {
            out.add(id);
        }
    }
    return out;
}

export const draftAgentIdsAtom = atom((get) => draftIds(get(wakeDraftsAtom), get(attachmentDraftsAtom)));

/** the mark's tooltip */
export const DRAFT_TITLE = "Unsent message in its box";
