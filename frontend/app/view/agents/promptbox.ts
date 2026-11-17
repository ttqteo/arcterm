// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The core every prompt box shares: Chat's message box (chatcomposer.tsx) and the New dialog's Task box
// (launcheragentfields.tsx). Both draw the text in the Lexical editor (chateditor.tsx) and take from here, so a feature
// added to one reaches the other: the text-and-caret plumbing (`setTextAt`), the `@` picker naming files and the live
// agents, runs, councils, conversations and initiatives (filemention.tsx, refmentionstore.ts), the `/` command menu
// (slashmenu.tsx), and the attachments' ways in: a paste, a drop of files or of paths, and the native file dialog
// (composerattachments.ts holds the chips). What each box adds stays with it: Chat's bash mode, recall, suggested
// replies and send; the launcher's flags, branch and launch. Each box draws the lists, the tray and its drop zone itself.

import { pushToast } from "@/app/cockpit/notificationstore";
import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import type { EditorLike, KeyLike } from "./chateditor";
import type { UseComposerAttachments } from "./composerattachments";
import { useFileMention, type FileMentionState } from "./filemention";
import { isPathsDrag, pathsFromDrop } from "./pathdrop";
import type { PickerLook } from "./pickerlist";
import { useRefItems } from "./refmentionstore";
import { useSlashMenu, type SlashMenuState } from "./slashmenu";

export const dragHasFiles = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes("Files");
// a drag that may name files by path (pathsFromDrop decides at the drop, when the data is readable)
export const dragNamesPaths = (dt: DataTransfer | null) => {
    const types = Array.from(dt?.types ?? []);
    return isPathsDrag(types) || types.includes("text/uri-list");
};

let picking = false; // the native dialog takes a moment to appear; a second click must not open another

export async function pickPaths(): Promise<string[]> {
    if (picking) {
        return [];
    }
    picking = true;
    try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ multiple: true, title: "Attach files" });
        return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    } catch (err) {
        console.error("prompt box: file picker failed", err);
        pushToast({ title: "Couldn't open the file picker", message: String(err), level: "error" });
        return [];
    } finally {
        picking = false;
    }
}

export interface PromptBoxOptions {
    text: string;
    setText: (text: string) => void;
    // names the box's lists for the CDP scenarios ("chat", "launcher")
    name: string;
    // the editor's handle, when the box's owner holds it (the New dialog focuses its Task box); else the hook makes one
    editorRef?: RefObject<EditorLike | null>;
    att: UseComposerAttachments;
    // the project folder whose files `@` lists ("" in Home or with none), and the folder a relative `@` walks from
    filesRoot: string;
    cwd?: string;
    // what the `@` refs are ordered and filtered by: the project's name and path, and the agent the box writes to ("" for
    // one not started yet), which the list leaves out
    projectName: string;
    projectPath: string;
    selfId: string;
    // the files `@` puts first, newest first
    recent?: readonly string[];
    look?: PickerLook;
    frame?: RefObject<HTMLElement | null>;
    // the `@` list stays shut (Chat's bash mode: a shell knows no mentions)
    mentionOff?: boolean;
    slash: {
        // the `/` menu stays shut: a harness with no slash commands, or a recalled command that is a message to resend
        off?: boolean;
        // the session's block, whose live command list the menu reads; with none it reads the commands on disk
        blockId?: string;
        inChat?: (name: string) => boolean;
        onRun?: (name: string) => void;
    };
}

export interface PromptBox {
    editorRef: RefObject<EditorLike | null>;
    // the text the box was last given or said: the editor's onChange skips a call that changes nothing
    told: { current: string };
    // the caret an outside change asks for (setTextAt), which the editor places as it draws the text
    outsideCaret: { current: { text: string; caret: number } | null };
    setTextAt: (text: string, caret?: number) => void;
    slash: SlashMenuState;
    mention: FileMentionState;
    // the menus read the caret from the editor after every edit or caret move
    onCaret: (box: EditorLike) => void;
    // the `/` menu's and the `@` picker's keys (↑↓, Enter and Tab to pick, Escape to close): at most one has a list open,
    // and a key one of them took comes back with defaultPrevented
    menuKeys: (e: KeyLike) => void;
    menuShown: boolean;
    // opens the native file dialog and attaches what is picked, in place
    attach: () => void;
    // a drag of files is over the box: it is the drop zone
    dragging: boolean;
    dropProps: {
        onDragEnter: (e: DragEvent<HTMLElement>) => void;
        onDragOver: (e: DragEvent<HTMLElement>) => void;
        onDragLeave: () => void;
        onDrop: (e: DragEvent<HTMLElement>) => void;
    };
    onPasteFiles: (e: ClipboardEvent) => boolean;
}

export function usePromptBox(o: PromptBoxOptions): PromptBox {
    const { text, setText, att } = o;
    const ownRef = useRef<EditorLike>(null);
    const editorRef = o.editorRef ?? ownRef;
    const told = useRef(text);
    told.current = text;
    const outsideCaret = useRef<{ text: string; caret: number } | null>(null);
    const setTextAt = (t: string, caret?: number) => {
        outsideCaret.current = caret == null ? null : { text: t, caret };
        told.current = t;
        setText(t);
    };
    const slash = useSlashMenu({
        text,
        setText: setTextAt,
        cwd: o.cwd ?? "",
        blockId: o.slash.blockId,
        inputRef: editorRef,
        off: o.slash.off,
        look: o.look,
        frame: o.frame,
        inChat: o.slash.inChat,
        onRun: o.slash.onRun,
    });
    // read while the text holds an `@`
    const refItems = useRefItems(
        o.filesRoot,
        o.projectName,
        o.projectPath,
        o.selfId,
        !o.mentionOff && text.includes("@")
    );
    const mention = useFileMention({
        text: o.mentionOff ? "" : text,
        setText: setTextAt,
        filesRoot: o.filesRoot,
        cwd: o.cwd,
        inputRef: editorRef,
        name: o.name,
        recent: o.recent,
        look: o.look,
        frame: o.frame,
        refs: refItems,
    });
    const onCaret = (box: EditorLike) => {
        slash.onCaret(box);
        mention.onCaret(box);
    };
    const menuKeys = (e: KeyLike) => {
        slash.onKeyDown(e);
        if (!e.defaultPrevented) {
            mention.onKeyDown(e);
        }
    };
    const attach = () => {
        void (async () => {
            const paths = await pickPaths();
            if (paths.length > 0) {
                att.addPaths(paths);
            }
            editorRef.current?.focus();
        })();
    };
    // A drag of files over the box turns it into the drop zone. dragenter and dragleave fire for every child the drag
    // crosses, so `dragDepth` counts the enters not yet left: the zone goes when the count is back to zero (the drag left
    // the box), and a drop or a dragend ends it at once. A dragover alone starts it too, so a box that missed the enter
    // (the drag began over it) still shows the zone.
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const endDrag = () => {
        dragDepth.current = 0;
        setDragging(false);
    };
    useEffect(() => {
        if (!dragging) {
            return;
        }
        // a drop elsewhere, or a drag cancelled with Escape, may never raise a dragleave on the box
        window.addEventListener("drop", endDrag, true);
        window.addEventListener("dragend", endDrag, true);
        return () => {
            window.removeEventListener("drop", endDrag, true);
            window.removeEventListener("dragend", endDrag, true);
        };
    }, [dragging]);
    const offersFiles = (dt: DataTransfer | null) => dragHasFiles(dt) || dragNamesPaths(dt);
    const dropProps: PromptBox["dropProps"] = {
        onDragEnter: (e) => {
            if (offersFiles(e.dataTransfer)) {
                dragDepth.current++;
                setDragging(true);
            }
        },
        // the webview's own drag-drop is off, so a file dropped unhandled would navigate it to the file: any drag that
        // holds files is taken here
        onDragOver: (e) => {
            if (offersFiles(e.dataTransfer)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                dragDepth.current = Math.max(dragDepth.current, 1);
                setDragging(true);
            }
        },
        onDragLeave: () => {
            if (dragDepth.current > 0 && --dragDepth.current === 0) {
                setDragging(false);
            }
        },
        // Explorer and Finder hand over real files (copied, as a paste is); arcterm's tree, VS Code, Obsidian and "Copy as
        // path" hand over paths as text, which the box would otherwise take as typed text: those attach in place
        onDrop: (e) => {
            endDrag();
            const dt = e.dataTransfer;
            if (dragHasFiles(dt)) {
                e.preventDefault();
                att.addFiles(Array.from(dt.files));
                return;
            }
            const paths = pathsFromDrop(Array.from(dt.types), (type) => dt.getData(type));
            if (paths == null || paths.length === 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            att.addPaths(paths);
            editorRef.current?.focus();
        },
    };
    // att.onPaste takes the files and calls preventDefault, or leaves the paste to the editor
    const onPasteFiles = (e: ClipboardEvent) => {
        att.onPaste(e as never);
        return e.defaultPrevented;
    };
    return {
        editorRef,
        told,
        outsideCaret,
        setTextAt,
        slash,
        mention,
        onCaret,
        menuKeys,
        menuShown: slash.shown || mention.shown,
        attach,
        dragging,
        dropProps,
        onPasteFiles,
    };
}
