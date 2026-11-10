// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The file pill of the chat message box (chateditor.tsx): a Lexical node that draws a file you @-mentioned as a chip (the
// file's icon and its short name, the full path on hover) where the message holds `@<path>`. Its text is exactly that
// mention (`mentionText`), so the box's plain text, which is what the agent receives, never changes with how a pill is
// drawn. Inline, and keyboard-selectable: Backspace beside it selects it (the accent ring), the next one deletes it.

import { cn } from "@/util/util";
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
import { File, Folder } from "lucide-react";
import type { JSX } from "react";
import { mentionText } from "./chateditormodel";
import { mentionBaseName } from "./filementiontokens";

export type SerializedFileMentionNode = Spread<{ path: string }, SerializedLexicalNode>;

function FileMentionPill({ nodeKey, path }: { nodeKey: NodeKey; path: string }) {
    const [editor] = useLexicalComposerContext();
    const [selected] = useLexicalNodeSelection(nodeKey);
    const Icon = /[\\/]$/.test(path) ? Folder : File;
    // a click selects the pill alone, so Backspace or Delete takes it away whole
    const select = () => {
        editor.update(() => {
            const selection = $createNodeSelection();
            selection.add(nodeKey);
            $setSelection(selection);
        });
        editor.getRootElement()?.focus({ preventScroll: true });
    };
    return (
        <span
            data-chat-pill={path}
            data-selected={selected ? "true" : undefined}
            title={path}
            onClick={select}
            className={cn(
                "mx-px inline-flex h-5 max-w-[240px] items-center gap-1 rounded-[6px] border px-1.5 align-middle text-[12.5px] leading-none text-ink-hi",
                selected ? "border-accent bg-accent/12" : "border-edge-mid bg-surface"
            )}
        >
            <Icon size={12} className={cn("shrink-0", selected ? "text-accent-soft" : "text-muted")} aria-hidden />
            <span className="truncate">{mentionBaseName(path)}</span>
        </span>
    );
}

export class FileMentionNode extends DecoratorNode<JSX.Element> {
    __path: string;

    static getType(): string {
        return "file-mention";
    }

    static clone(node: FileMentionNode): FileMentionNode {
        return new FileMentionNode(node.__path, node.__key);
    }

    static importJSON(serialized: SerializedFileMentionNode): FileMentionNode {
        return $createFileMentionNode(serialized.path);
    }

    constructor(path: string, key?: NodeKey) {
        super(key);
        this.__path = path;
    }

    exportJSON(): SerializedFileMentionNode {
        return { ...super.exportJSON(), path: this.getPath() };
    }

    createDOM(): HTMLElement {
        return document.createElement("span");
    }

    updateDOM(): boolean {
        return false;
    }

    getPath(): string {
        return this.getLatest().__path;
    }

    /** the mention the pill stands for, which is how it is written in the box's text */
    getTextContent(): string {
        return mentionText(this.getPath());
    }

    isInline(): boolean {
        return true;
    }

    isKeyboardSelectable(): boolean {
        return true;
    }

    decorate(): JSX.Element {
        return <FileMentionPill nodeKey={this.__key} path={this.__path} />;
    }
}

export function $createFileMentionNode(path: string): FileMentionNode {
    return $applyNodeReplacement(new FileMentionNode(path));
}

export function $isFileMentionNode(node: LexicalNode | null | undefined): node is FileMentionNode {
    return node instanceof FileMentionNode;
}
