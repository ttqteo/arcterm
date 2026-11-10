// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `@` file picker of a text box: the New launcher's Task box and the chat box. An `@` typed lists the folder's files
// above the box, the files the agent touched first and what the query matched marked, and a pick puts `@<path>` in the
// text (launchermention.ts holds the pure rules).

import { FileIcon } from "@/app/element/fileicon";
import { reloadFileIndex } from "@/app/view/code/codestore";
import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { fileMentionAt, fileMentionMatches, insertFileMention, mentionMatchMask, mentionRuns } from "./launchermention";
import { PickerList } from "./pickerlist";

export interface FileMentionState {
    // the dropdown under the box, portaled out of its container (it draws nothing while no list shows)
    list: ReactNode;
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    onCaret: (el: HTMLTextAreaElement) => void;
}

// A text box's `@` picker (the New launcher's Task box, the chat box), a list above the box (pickerlist.tsx, which
// portals it out of the box). `recent` (newest first, relative to `filesRoot`) leads the list: the chat box passes the
// files its agent touched. The files are read again on the first `@` after each mount of the box (the launcher
// unmounts it on close): there is no watcher, and an agent creates files meanwhile. A query no file matches shows
// nothing, so an `@` meant as text never blocks Enter. `filesRoot` "" turns it off. `name` tags the list for scenarios
// (`data-<name>-mentions`, an option `data-<name>-mention`).
export function useFileMention({
    text: task,
    setText,
    filesRoot,
    inputRef: taskRef,
    name,
    recent,
}: {
    text: string;
    setText: (text: string) => void;
    filesRoot: string;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    name: string;
    recent?: readonly string[];
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
    const matches = open && own?.paths != null ? fileMentionMatches(mention.query, own.paths, undefined, recent) : [];
    const note = !open
        ? null
        : own?.error
          ? "Could not list the project's files"
          : own?.paths == null
            ? "Listing files…"
            : null;
    const shown = note != null || matches.length > 0;
    const at = Math.min(pick, Math.max(matches.length - 1, 0));
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

    const list = (
        <PickerList
            anchor={taskRef}
            shown={shown}
            note={note}
            items={matches}
            at={at}
            onPick={choose}
            onHover={setPick}
            label="Project files"
            listAttr={`data-${name}-mentions`}
            itemAttr={`data-${name}-mention`}
            side="above"
            itemKey={(path) => path}
            itemTitle={(path) => path}
            renderItem={(path) => {
                const slash = path.lastIndexOf("/");
                const mask = mentionMatchMask(mention?.query ?? "", path);
                return (
                    <>
                        <FileIcon path={path} size={14} />
                        <span className="shrink-0 text-[12px] text-primary">
                            <MatchRuns path={path} mask={mask} start={slash + 1} end={path.length} />
                        </span>
                        <span className="min-w-0 truncate text-[11px] text-muted">
                            {slash === -1 ? "" : <MatchRuns path={path} mask={mask} start={0} end={slash} />}
                        </span>
                    </>
                );
            }}
        />
    );
    return { list, onKeyDown, onCaret };
}

// a slice of a listed path with the characters the query matched in the accent colour
function MatchRuns({ path, mask, start, end }: { path: string; mask: boolean[]; start: number; end: number }) {
    return (
        <>
            {mentionRuns(path, mask, start, end).map((run, i) =>
                run.hit ? (
                    <span key={i} data-mention-hit="" className="font-semibold text-accent">
                        {run.text}
                    </span>
                ) : (
                    run.text
                )
            )}
        </>
    );
}
