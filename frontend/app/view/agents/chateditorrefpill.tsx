// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The badge of an `agent:<id>`, `run:<id>` or `council:<id>` reference in the chat message box (chateditor.tsx): a Lexical
// node beside the file pill's (chateditorpill.tsx), drawing the same badge your sent bubble does (chatrefbadge.tsx
// RefBadgeFace, resolved live through useResolvedRef). Its text is the token as it was written (`raw`, `@` and case
// kept), so the box's plain text, which is what the agent receives, never changes with how a badge is drawn. Inline and
// keyboard-selectable like the file pill: a click selects it, Backspace beside it selects it, the next one deletes it
// whole. In the box a click selects, it never opens (the bubble's badge opens), and nothing animates.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
    $applyNodeReplacement,
    $createNodeSelection,
    $setSelection,
    DecoratorNode,
    type LexicalNode,
    type NodeKey,
    type SerializedLexicalNode,
    type Spread,
} from "lexical";
import type { JSX } from "react";
import { RefBadgeFace, useResolvedRef } from "./chatrefbadge";
import type { RefKind } from "./refmention";

export type SerializedRefMentionNode = Spread<{ refKind: RefKind; id: string; raw: string }, SerializedLexicalNode>;

function RefMentionPill({ nodeKey, kind, id, raw }: { nodeKey: NodeKey; kind: RefKind; id: string; raw: string }) {
    const [editor] = useLexicalComposerContext();
    const [selected] = useLexicalNodeSelection(nodeKey);
    // with no ChatRefLinks above the box nothing is known: the unresolved look
    const resolved = useResolvedRef(kind, id);
    // a click selects the badge alone, so Backspace or Delete takes it away whole
    const select = () => {
        editor.update(() => {
            const selection = $createNodeSelection();
            selection.add(nodeKey);
            $setSelection(selection);
        });
        editor.getRootElement()?.focus({ preventScroll: true });
    };
    return (
        <span onClick={select}>
            <RefBadgeFace resolved={resolved} raw={raw} selected={selected} opens={false} />
        </span>
    );
}

export class RefMentionNode extends DecoratorNode<JSX.Element> {
    __refKind: RefKind;
    __id: string;
    __raw: string;

    static getType(): string {
        return "ref-mention";
    }

    static clone(node: RefMentionNode): RefMentionNode {
        return new RefMentionNode(node.__refKind, node.__id, node.__raw, node.__key);
    }

    static importJSON(serialized: SerializedRefMentionNode): RefMentionNode {
        return $createRefMentionNode(serialized.refKind, serialized.id, serialized.raw);
    }

    constructor(refKind: RefKind, id: string, raw: string, key?: NodeKey) {
        super(key);
        this.__refKind = refKind;
        this.__id = id;
        this.__raw = raw;
    }

    exportJSON(): SerializedRefMentionNode {
        return { ...super.exportJSON(), refKind: this.getRefKind(), id: this.getId(), raw: this.getRaw() };
    }

    createDOM(): HTMLElement {
        return document.createElement("span");
    }

    updateDOM(): boolean {
        return false;
    }

    getRefKind(): RefKind {
        return this.getLatest().__refKind;
    }

    /** the id as the model lowercased it (the full id the badge resolves against) */
    getId(): string {
        return this.getLatest().__id;
    }

    /** the token as it was written in the message, `@` and case kept */
    getRaw(): string {
        return this.getLatest().__raw;
    }

    /** the token the badge stands for, which is how it is written in the box's text */
    getTextContent(): string {
        return this.getRaw();
    }

    isInline(): boolean {
        return true;
    }

    isKeyboardSelectable(): boolean {
        return true;
    }

    decorate(): JSX.Element {
        return <RefMentionPill nodeKey={this.__key} kind={this.__refKind} id={this.__id} raw={this.__raw} />;
    }
}

export function $createRefMentionNode(refKind: RefKind, id: string, raw: string): RefMentionNode {
    return $applyNodeReplacement(new RefMentionNode(refKind, id, raw));
}

export function $isRefMentionNode(node: LexicalNode | null | undefined): node is RefMentionNode {
    return node instanceof RefMentionNode;
}
