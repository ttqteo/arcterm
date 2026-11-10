// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A tagged block of your message as a folded card in your bubble (chattagblocks.ts says which): a paste the harness
// wrapped, a system reminder, a slash command's blocks, command output, or any other <tag>…</tag>. Closed it is one line
// ("Pasted · 12 lines"); open it shows the body in mono, scrolling past 320 px, with a copy button. TaggedPromptText is the
// whole message: its text as the bubble draws it, its blocks as these cards, so your bubble and its pending copy split a
// message the same way.

import { CopyButton } from "@/app/element/copybutton";
import { cn } from "@/util/util";
import { Braces, ChevronDown, ChevronRight, ClipboardPaste, Terminal } from "lucide-react";
import { useState } from "react";
import { foldCommandParts, splitTagged, tagHeading, type TagPart } from "./chattagblocks";
import { PromptText } from "./narrationtimeline";

function TagIcon({ tag }: { tag: string }) {
    if (tag === "pasted_content") {
        return <ClipboardPaste size={13} strokeWidth={2} aria-hidden className="flex-none" />;
    }
    if (tag.startsWith("command-") || tag.startsWith("local-command-")) {
        return <Terminal size={13} strokeWidth={2} aria-hidden className="flex-none" />;
    }
    return <Braces size={13} strokeWidth={2} aria-hidden className="flex-none" />;
}

export function ChatTagBlock({ tag, attrs, body, label }: Omit<TagPart, "kind">) {
    const [open, setOpen] = useState(false);
    // a command with no message (a bare /clear) has nothing to open
    const canOpen = body !== "";
    const heading = tagHeading({ kind: "tag", tag, attrs, body, label });
    const Chevron = open ? ChevronDown : ChevronRight;
    const header = (
        <>
            <TagIcon tag={tag} />
            <span className="min-w-0 truncate">{heading}</span>
            <span className="flex-1" />
            {canOpen ? <Chevron size={12} strokeWidth={2.2} aria-hidden className="flex-none" /> : null}
        </>
    );
    const headerClass = "flex h-8 w-full items-center gap-2 px-3 text-[12px] text-muted";
    return (
        <div
            data-chat-tag={tag}
            className="w-full min-w-[220px] rounded-[8px] border border-edge-mid bg-surface text-left"
        >
            {canOpen ? (
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className={cn(headerClass, "cursor-pointer hover:text-secondary")}
                >
                    {header}
                </button>
            ) : (
                <div className={headerClass}>{header}</div>
            )}
            {canOpen && open ? (
                <div data-chat-tag-body className="relative border-t border-edge-faint">
                    <div className="max-h-[320px] overflow-auto px-3 py-2 pr-9 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap text-ink-mid [overflow-wrap:anywhere]">
                        {body}
                    </div>
                    <div className="absolute right-1 top-1 rounded-md bg-surface">
                        <CopyButton title="Copy" content={body} className="p-1 text-[12px]" />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/** Your message as a bubble holds it: its text as PromptText (an `@path` drawn as a pill) and each tagged block in it as
 *  a folded card, full width of the bubble. */
export function TaggedPromptText({ text }: { text: string }) {
    const parts = foldCommandParts(splitTagged(text));
    return (
        <>
            {parts.map((part, i) =>
                part.kind === "text" ? (
                    <PromptText key={i} text={part.text} mentions />
                ) : (
                    <div key={i} className="my-1.5">
                        <ChatTagBlock tag={part.tag} attrs={part.attrs} body={part.body} label={part.label} />
                    </div>
                )
            )}
        </>
    );
}
