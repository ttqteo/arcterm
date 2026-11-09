// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `@` file picker of a text box: the New launcher's Task box and the chat box. An `@` typed lists the folder's files
// under the box, and a pick puts `@<path>` in the text (launchermention.ts holds the pure rules).

import { FileIcon } from "@/app/element/fileicon";
import { reloadFileIndex } from "@/app/view/code/codestore";
import { cn } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, size as floatingSize, offset, shift, useFloating } from "@floating-ui/react";
import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { fileMentionAt, fileMentionMatches, insertFileMention } from "./launchermention";

export interface FileMentionState {
    // the dropdown under the box, portaled out of its container, or null when none shows
    list: ReactNode;
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    onCaret: (el: HTMLTextAreaElement) => void;
}

const MENTION_MIN_WIDTH = 360;
const MENTION_MAX_WIDTH = 560;
const MENTION_MAX_HEIGHT = 320;

// A text box's `@` picker (the New launcher's Task box, the chat box), a dropdown under the box. It is portaled out, as
// the launcher's route picker is: the launcher's fields area scrolls, and a chat cell clips, so a dropdown inside either
// would be cut off at its edge. The files are read again on the first `@` after each mount of the box (the launcher
// unmounts it on close): there is no watcher, and an agent creates files meanwhile. A query no file matches shows
// nothing, so an `@` meant as text never blocks Enter. `filesRoot` "" turns it off. `name` tags the list for scenarios
// (`data-<name>-mentions`, an option `data-<name>-mention`).
export function useFileMention({
    text: task,
    setText,
    filesRoot,
    inputRef: taskRef,
    name,
}: {
    text: string;
    setText: (text: string) => void;
    filesRoot: string;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    name: string;
}): FileMentionState {
    const [caret, setCaret] = useState(0);
    const [pick, setPick] = useState(0);
    // the `@` whose list Escape closed; it stays closed until the caret leaves it
    const [dismissed, setDismissed] = useState(-1);
    const [listing, setListing] = useState<{ root: string; paths?: string[]; error?: boolean } | null>(null);
    const mention = filesRoot === "" ? null : fileMentionAt(task, caret);
    const open = mention != null && mention.start !== dismissed;
    useEffect(() => {
        if (!open || listing?.root === filesRoot) {
            return;
        }
        setListing({ root: filesRoot });
        reloadFileIndex(filesRoot).then(
            (idx) => setListing((cur) => (cur?.root === filesRoot ? { root: filesRoot, paths: idx.paths } : cur)),
            () => setListing((cur) => (cur?.root === filesRoot ? { root: filesRoot, error: true } : cur))
        );
    }, [open, filesRoot, listing?.root]);
    const own = listing?.root === filesRoot ? listing : null;
    const matches = open && own?.paths != null ? fileMentionMatches(mention.query, own.paths) : [];
    const note = !open
        ? null
        : own?.error
          ? "Could not list the project's files"
          : own?.paths == null
            ? "Listing files…"
            : null;
    const shown = note != null || matches.length > 0;
    const at = Math.min(pick, Math.max(matches.length - 1, 0));
    const { refs, floatingStyles } = useFloating({
        open: shown,
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [
            offset(4),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            floatingSize({
                padding: 8,
                apply({ rects, availableHeight, elements }) {
                    const width = Math.min(Math.max(rects.reference.width, MENTION_MIN_WIDTH), MENTION_MAX_WIDTH);
                    elements.floating.style.width = `${width}px`;
                    elements.floating.style.setProperty(
                        "--mention-max-height",
                        `${Math.min(MENTION_MAX_HEIGHT, availableHeight)}px`
                    );
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    // anchored to the box itself, so the list starts under the text and follows the box as it grows
    useEffect(() => {
        refs.setReference(shown ? taskRef.current : null);
    }, [shown, refs, taskRef]);

    const choose = (path: string) => {
        const next = insertFileMention(task, mention.start, caret, path);
        setText(next.text);
        setCaret(next.caret);
        setPick(0);
        requestAnimationFrame(() => {
            taskRef.current?.focus();
            taskRef.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    // the picker's keys stop here: the box's own handler would send on Enter (the chat box, the launcher's dialog), and
    // the dialog's trap Tab and close on Escape
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!shown || e.nativeEvent.isComposing) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(mention.start);
            return;
        }
        if (matches.length === 0 || e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const n = matches.length;
            setPick((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            choose(matches[at]);
        }
    };
    // a keystroke or a click moves the caret and starts the list from its best match again; ↑↓ do not (the picker
    // takes them, so the caret stays)
    const onCaret = (el: HTMLTextAreaElement) => {
        setCaret(el.selectionStart);
        setPick(0);
        if (fileMentionAt(el.value, el.selectionStart) == null) {
            setDismissed(-1);
        }
    };

    const list = !shown ? null : (
        <FloatingPortal>
            {/* above ModalShell's z-[70] backdrop (the launcher), as the route picker sits */}
            <div ref={refs.setFloating} style={floatingStyles} className="z-[80]">
                <ul
                    role="listbox"
                    {...{ [`data-${name}-mentions`]: "" }}
                    aria-label="Project files"
                    className="m-0 flex max-h-[var(--mention-max-height)] list-none flex-col overflow-y-auto rounded-[11px] border border-border bg-surface p-[5px] shadow-popover-md"
                >
                    {note != null ? (
                        <li className="px-2 py-[5px] text-[12px] text-muted">{note}</li>
                    ) : (
                        matches.map((path, i) => {
                            const slash = path.lastIndexOf("/");
                            return (
                                <li
                                    key={path}
                                    role="option"
                                    aria-selected={i === at}
                                    {...{ [`data-${name}-mention`]: path }}
                                    title={path}
                                    onMouseDown={(e) => {
                                        // keep focus in the Task box
                                        e.preventDefault();
                                        choose(path);
                                    }}
                                    onMouseMove={() => setPick(i)}
                                    className={cn(
                                        "flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] px-2 py-[5px]",
                                        i === at && "bg-surface-hover"
                                    )}
                                >
                                    <FileIcon path={path} size={14} />
                                    <span className="shrink-0 text-[12px] text-primary">{path.slice(slash + 1)}</span>
                                    <span className="min-w-0 truncate text-[11px] text-muted">
                                        {slash === -1 ? "" : path.slice(0, slash)}
                                    </span>
                                </li>
                            );
                        })
                    )}
                </ul>
            </div>
        </FloatingPortal>
    );
    return { list, onKeyDown, onCaret };
}
