// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One line of inline markdown whose links are not clickable. The desktop popup page bundles this file
// and opens no wavesrv connection, so nothing here may import the cockpit store.

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function condenseToLine(text: string): string {
    const firstPara = text.split(/\n\s*\n/)[0] ?? "";
    return firstPara
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*>\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .replace(/\s*\n\s*/g, " ")
        .trim();
}

const INLINE_ALLOWED = ["a", "strong", "em", "code", "del"];

// for a line that is itself a button: a nested anchor would be invalid and would steal the click
export const PLAIN_LINK_COMPONENTS: Components = {
    a: ({ children }) => <span className="text-accent">{children}</span>,
    code: ({ children }) => <code className="font-mono text-accent-soft">{children}</code>,
};

export function PlainInlineMarkdown({
    text,
    components = PLAIN_LINK_COMPONENTS,
}: {
    text: string;
    components?: Components;
}) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            allowedElements={INLINE_ALLOWED}
            unwrapDisallowed
            components={components}
        >
            {condenseToLine(text)}
        </ReactMarkdown>
    );
}
