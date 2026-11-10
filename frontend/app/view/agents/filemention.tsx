// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `@` file picker of a text box: the New launcher's Task box and the chat box. An `@` typed lists the folder's files
// above the box, the files the agent touched first and what the query matched marked, and a pick puts `@<path>` in the
// text (launchermention.ts holds the pure rules). A path that starts at a root (`@../`, `@./`, `@~/`, `@D:/`, `@/`) is a
// walk instead: the picker lists that folder's entries, read off the disk, and a folder pick steps into it.

import { FileIcon } from "@/app/element/fileicon";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { reloadFileIndex } from "@/app/view/code/codestore";
import { makeConnRoute } from "@/util/util";
import { File as FileGlyph, Folder } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EditorLike, KeyLike } from "./chateditor";
import {
    browseMatches,
    browseQuery,
    fileMentionAt,
    fileMentionMatches,
    insertBrowsePick,
    insertFileMention,
    mentionMatchMask,
    mentionRuns,
    resolveBrowseDir,
    type BrowseEntry,
} from "./launchermention";
import { homeDir } from "./pathlinkroute";
import { PickerList } from "./pickerlist";

export interface FileMentionState {
    // the dropdown under the box, portaled out of its container (it draws nothing while no list shows)
    list: ReactNode;
    // the list is on screen (rows, or a note while it is being read)
    shown: boolean;
    onKeyDown: (e: KeyLike) => void;
    onCaret: (el: EditorLike) => void;
}

// a row of the list: a path of the project's own ranking, or an entry of the folder being walked (`key` is the text a
// pick writes for it: `../src/`, `../a.ts`)
type MentionRow = { kind: "path"; path: string } | { kind: "entry"; key: string; name: string; isdir: boolean };

const rowKey = (row: MentionRow) => (row.kind === "path" ? row.path : row.key);

// one folder's listing while the picker is open: nothing yet (being read), its entries, or an error
type DirListing = { entries?: BrowseEntry[]; error?: boolean };

// The entries of the folder `dir` (as typed in the `@` path), read from the disk through wavesrv: relative to `base`, `~`
// as the home folder. Throws when the folder cannot be placed or read.
async function listDir(base: string, dir: string): Promise<BrowseEntry[]> {
    const home = dir.startsWith("~") ? await homeDir() : "";
    const abs = resolveBrowseDir(base, dir, home);
    if (abs == null) {
        throw new Error(`cannot place ${dir}`);
    }
    const entries: BrowseEntry[] = [];
    const gen = RpcApi.RemoteListEntriesCommand(TabRpcClient, { path: abs }, { route: makeConnRoute(null) });
    for await (const chunk of gen) {
        entries.push(...(chunk.fileinfo ?? []));
    }
    return entries;
}

// A text box's `@` picker (the New launcher's Task box, the chat box), a list above the box (pickerlist.tsx, which
// portals it out of the box). `recent` (newest first, relative to `filesRoot`) leads the list: the chat box passes the
// files its agent touched. The files are read again on the first `@` after each mount of the box (the launcher
// unmounts it on close): there is no watcher, and an agent creates files meanwhile. A query no file matches shows
// nothing, so an `@` meant as text never blocks Enter. `filesRoot` is the project's folder, whose files a bare query
// ranks; "" turns that off. A path that starts at a root walks folders instead, from `filesRoot`, else from `cwd` (an
// agent outside a registered project has a folder but no file list); with neither the picker is off. Each folder is
// read once while the list is open. `name` tags the list for scenarios (`data-<name>-mentions`, an option
// `data-<name>-mention`). `setText` takes the caret a pick puts the text's caret at, for a box that draws the text again
// (the chat editor): a folder pick (`@../src/`) leaves the mention the caret ends, which stays text to keep walking
// instead of becoming a pill. A mention that already is a pill (the editor's `onPill`: the caret right after one, or one
// selected) is never one being typed, so the list stays shut on it.
export function useFileMention({
    text: task,
    setText,
    filesRoot,
    cwd,
    inputRef: taskRef,
    name,
    recent,
}: {
    text: string;
    setText: (text: string, caret?: number) => void;
    filesRoot: string;
    cwd?: string;
    inputRef: RefObject<EditorLike | null>;
    name: string;
    recent?: readonly string[];
}): FileMentionState {
    const [caret, setCaret] = useState(0);
    // the selection is on a pill (the chat editor tells: EditorLike.onPill): that mention is complete, not one being typed
    const [onPill, setOnPill] = useState(false);
    const [pick, setPick] = useState(0);
    // the `@` whose list Escape closed; it stays closed until the caret leaves it
    const [dismissed, setDismissed] = useState(-1);
    const [listing, setListing] = useState<{ root: string; paths?: string[]; error?: boolean } | null>(null);
    // the folders read since the list opened, by base and typed folder; closing it forgets them (the disk moves on)
    const [dirs, setDirs] = useState<Record<string, DirListing>>({});
    // counts the closings: a folder still being read when the list closed must not land in the next opening's cache
    const opening = useRef(0);
    const base = filesRoot || cwd || "";
    const mention = base === "" || onPill ? null : fileMentionAt(task, caret);
    const open = mention != null && mention.start !== dismissed;
    const browse = open ? browseQuery(mention.query) : null;
    const browseDir = browse?.dir ?? null;
    const projectOpen = open && browse == null && filesRoot !== "";
    useEffect(() => {
        if (!projectOpen || listing?.root === filesRoot) {
            return;
        }
        setListing({ root: filesRoot });
        reloadFileIndex(filesRoot).then(
            (idx) => setListing((cur) => (cur?.root === filesRoot ? { root: filesRoot, paths: idx.paths } : cur)),
            () => setListing((cur) => (cur?.root === filesRoot ? { root: filesRoot, error: true } : cur))
        );
    }, [projectOpen, filesRoot, listing?.root]);
    useEffect(() => {
        if (!open) {
            opening.current++;
            setDirs((cur) => (Object.keys(cur).length === 0 ? cur : {}));
        }
    }, [open]);
    const dirKey = browseDir == null ? null : `${base}\n${browseDir}`;
    const dirListing = dirKey == null ? undefined : dirs[dirKey];
    useEffect(() => {
        if (dirKey == null || browseDir == null || dirListing != null) {
            return;
        }
        const mine = opening.current;
        const settle = (next: DirListing) => {
            if (opening.current === mine) {
                setDirs((cur) => ({ ...cur, [dirKey]: next }));
            }
        };
        setDirs((cur) => ({ ...cur, [dirKey]: {} }));
        listDir(base, browseDir).then(
            (entries) => settle({ entries }),
            () => settle({ error: true })
        );
    }, [dirKey, browseDir, base, dirListing]);
    const own = listing?.root === filesRoot ? listing : null;
    let rows: MentionRow[] = [];
    let note: string | null = null;
    if (browse != null) {
        if (dirListing?.entries != null) {
            rows = browseMatches(dirListing.entries, browse.leaf).map((e) => ({
                kind: "entry" as const,
                key: `${browse.dir}${e.name}${e.isdir ? "/" : ""}`,
                name: e.name ?? "",
                isdir: !!e.isdir,
            }));
        } else {
            note = dirListing?.error ? `Cannot read ${browse.dir}` : "Listing files…";
        }
    } else if (projectOpen) {
        if (own?.paths != null) {
            rows = fileMentionMatches(mention.query, own.paths, undefined, recent).map((path) => ({
                kind: "path" as const,
                path,
            }));
        } else {
            note = own?.error ? "Could not list the project's files" : "Listing files…";
        }
    }
    const shown = note != null || rows.length > 0;
    const at = Math.min(pick, Math.max(rows.length - 1, 0));
    const choose = (row: MentionRow) => {
        const next =
            row.kind === "path"
                ? insertFileMention(task, mention.start, caret, row.path)
                : insertBrowsePick(task, mention.start, caret, browse.dir, row);
        setText(next.text, next.caret);
        setCaret(next.caret);
        setOnPill(false);
        setPick(0);
        requestAnimationFrame(() => {
            taskRef.current?.focus();
            taskRef.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    // the picker's keys stop here: the box's own handler would send on Enter (the chat box, the launcher's dialog), and
    // the dialog's trap Tab and close on Escape
    const onKeyDown = (e: KeyLike) => {
        if (!shown || e.nativeEvent.isComposing) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(mention.start);
            return;
        }
        if (rows.length === 0 || e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const n = rows.length;
            setPick((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            choose(rows[at]);
        }
    };
    // a keystroke or a click that moves the caret starts the list from its best match again; ↑↓ do not (the picker takes
    // them, so the caret stays), and neither does a select event that finds the caret where it was (the first key after
    // the box is focused raises one, which would send a first ↓ back to the top once its key is up). On a pill the list
    // is shut: the box's text ends in the pill's `@path` at the caret, which reads as a path being typed.
    const onCaret = (el: EditorLike) => {
        const atPill = el.onPill === true;
        setOnPill(atPill);
        if (el.selectionStart !== caret) {
            setCaret(el.selectionStart);
            setPick(0);
        }
        if (atPill || fileMentionAt(el.value, el.selectionStart) == null) {
            setDismissed(-1);
        }
    };

    const list = (
        <PickerList
            anchor={taskRef}
            shown={shown}
            note={note}
            items={rows}
            at={at}
            onPick={choose}
            onHover={setPick}
            label={browse != null ? "Folder entries" : "Project files"}
            listAttr={`data-${name}-mentions`}
            itemAttr={`data-${name}-mention`}
            side="above"
            itemKey={rowKey}
            itemTitle={rowKey}
            renderItem={(row) => {
                if (row.kind === "entry") {
                    const Icon = row.isdir ? Folder : FileGlyph;
                    return (
                        <>
                            <Icon size={14} className="shrink-0 text-muted" aria-hidden />
                            <span className="min-w-0 truncate text-[12px] text-primary">
                                {row.isdir ? `${row.name}/` : row.name}
                            </span>
                        </>
                    );
                }
                const path = row.path;
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
    return { list, shown, onKeyDown, onCaret };
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
