// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A prose sentence's tokens as React elements, never an HTML string, so the word diff and the view share one
// model: a code token edited inside a sentence keeps its code styling. Adjacent tokens of one kind and one diff op
// draw as one element, so `wsh ask` is one code chip and a run of inserted words one tint. Math renders with KaTeX
// into its own node.

import { cn } from "@/util/util";
import katex from "katex";
import { Fragment, useLayoutEffect, useRef, type ReactNode } from "react";
import type { ProseToken, TokenKind } from "./docprose";

export type TokenOp = "same" | "insert" | "delete";

export interface OpToken {
    token: ProseToken;
    op: TokenOp;
}

// the diff tints: inserted words on diff-added, struck ones on diff-removed in the mid ink
export const INSERTED = "rounded-[2px] bg-diff-added/15 text-primary";
export const DELETED = "rounded-[2px] bg-diff-removed/10 text-ink-mid line-through decoration-diff-removed";

const OP_CLASS: Record<TokenOp, string> = { same: "", insert: INSERTED, delete: DELETED };

// kinds a run of words can share one element in; math, images and placeholders are one token each
const MERGES = new Set<TokenKind>(["text", "em", "strong", "code", "ref", "cite", "link"]);

interface Run {
    kind: TokenKind;
    op: TokenOp;
    text: string;
    href?: string;
    display?: boolean;
}

function runsOf(tokens: OpToken[]): Run[] {
    const runs: Run[] = [];
    for (const { token, op } of tokens) {
        const last = runs[runs.length - 1];
        if (last && MERGES.has(token.kind) && last.kind === token.kind && last.op === op && last.href === token.href) {
            last.text += token.text;
            continue;
        }
        runs.push({ kind: token.kind, op, text: token.text, href: token.href, display: token.display });
    }
    return runs;
}

export function MathToken({ tex, display }: { tex: string; display?: boolean }) {
    const ref = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        if (ref.current != null) {
            katex.render(tex, ref.current, { displayMode: !!display, throwOnError: false });
        }
    }, [tex, display]);
    return <span ref={ref} className={display ? "block overflow-x-auto" : undefined} />;
}

function runBody(run: Run, text: string, onLink: (href: string) => void, image: (run: Run) => ReactNode): ReactNode {
    switch (run.kind) {
        case "em":
            return <em>{text}</em>;
        case "strong":
            return <strong className="font-semibold text-primary">{text}</strong>;
        case "code":
            return <code className="font-mono text-[13px]">{text}</code>;
        case "ref":
        case "cite":
            return <span className={cn("font-mono text-[12.5px]", run.op === "same" && "text-muted")}>{text}</span>;
        case "link":
            return (
                <a
                    href={run.href}
                    title={run.href}
                    onClick={(e) => {
                        e.preventDefault();
                        onLink(run.href ?? "");
                    }}
                    className="cursor-pointer text-accent-soft hover:underline"
                >
                    {text}
                </a>
            );
        case "math":
            return <MathToken tex={run.text} display={run.display} />;
        case "image":
            return image(run);
        case "placeholder":
            return <span className="italic text-muted">{text}</span>;
        default:
            return text;
    }
}

// Each run's trailing space sits outside its element, so a code chip or a tint ends at its last character; the
// space keeps the op's tint only between two words of one run.
export function ProseTokens({
    tokens,
    onLink,
    image,
}: {
    tokens: OpToken[];
    onLink: (href: string) => void;
    image: (alt: string, src: string) => ReactNode;
}) {
    const runs = runsOf(tokens);
    return (
        <>
            {runs.map((run, i) => {
                const text = run.text.trimEnd();
                const space = run.text.slice(text.length);
                const body = runBody(run, text, onLink, (r) => image(r.text, r.href ?? ""));
                const next = runs[i + 1];
                // a struck word followed straight by its replacement reads as one word without a gap
                const gap = space === "" && run.op === "delete" && next?.op === "insert" ? " " : space;
                return (
                    <Fragment key={i}>
                        {run.op === "same" ? body : <span className={OP_CLASS[run.op]}>{body}</span>}
                        {gap}
                    </Fragment>
                );
            })}
        </>
    );
}
