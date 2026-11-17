// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// One search hit's snippet on one truncated line, the words the search matched marked. Shared by the New agent
// dialog's content rows and Conversation History's results.

import { snippetParts } from "./sessionsearch";

export function SearchSnippet({ hit }: { hit: SessionHit }) {
    return (
        <span data-search-snippet className="block min-w-0 truncate text-[12px] text-muted">
            {snippetParts(hit.text, hit.marks).map((part, i) =>
                part.mark ? (
                    <mark key={i} data-search-mark className="rounded-sm bg-accentbg text-primary">
                        {part.text}
                    </mark>
                ) : (
                    <span key={i}>{part.text}</span>
                )
            )}
        </span>
    );
}
