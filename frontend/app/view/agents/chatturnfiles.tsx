// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The card at a finished turn's end in Chat, as Claude Desktop's "Changed N files": every file the turn's edits changed
// (chatsteps.ts turnFiles), its name bright, its folder muted and its +N −N summed over the turn. Two files or more: an
// "Edited N files" header, a row each, and See all with the turn's totals; one file: its row alone. A row opens that file
// in the rail, in a tab of its own on its Diff against the last commit, See all the Diff on the agent's working tree; with nothing to open them in (an ended
// session's transcript) the rows are plain text and See all is left out. The Diff shows the working tree now, the card's
// numbers are the turn's. Design:
// .superpowers/design/chat-compact-work/project/Calm.dc.html (bottom).

import { cn } from "@/util/util";
import { Code, File } from "lucide-react";
import { fileWhere, type TurnFile } from "./chatsteps";

// what reads as prose rather than code gets the plain file icon
const DOC_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc|tex)$/i;

const ROW = "flex min-w-0 items-center gap-2 px-3 py-[9px] text-left text-[13px]";

function Counts({ adds, dels }: { adds: number; dels: number }) {
    return (
        <span data-chat-turn-files-counts className="ml-auto inline-flex shrink-0 gap-1 pl-2 tabular-nums">
            <span className="text-success">+{adds}</span>
            {dels > 0 ? <span className="text-error">−{dels}</span> : null}
        </span>
    );
}

// a row that opens something when there is somewhere to open it, else the same row as plain text
function Row({
    onOpen,
    className,
    children,
    ...data
}: {
    onOpen?: () => void;
    className?: string;
    children: React.ReactNode;
    [data: `data-${string}`]: string | undefined;
}) {
    if (onOpen == null) {
        return (
            <div {...data} className={cn(ROW, className)}>
                {children}
            </div>
        );
    }
    return (
        <button
            type="button"
            {...data}
            onClick={onOpen}
            className={cn(ROW, "w-full cursor-pointer hover:bg-surface", className)}
        >
            {children}
        </button>
    );
}

function FileRow({
    file,
    cwd,
    onOpen,
    first,
}: {
    file: TurnFile;
    cwd: string | null | undefined;
    onOpen?: () => void;
    first: boolean;
}) {
    const { name, folder } = fileWhere(file.path, cwd);
    const Icon = DOC_FILE.test(name) ? File : Code;
    return (
        <Row data-chat-turn-file={file.path} onOpen={onOpen} className={cn(!first && "border-t border-border")}>
            <Icon size={14} strokeWidth={2} aria-hidden className="shrink-0 text-muted" />
            <span data-chat-turn-file-name title={file.path} className="min-w-0 shrink truncate text-primary">
                {name}
            </span>
            {folder !== "" ? (
                <span data-chat-turn-file-folder className="min-w-0 shrink-[2] truncate text-muted">
                    {folder}
                </span>
            ) : null}
            <Counts adds={file.adds} dels={file.dels} />
        </Row>
    );
}

export function ChatTurnFiles({
    files,
    cwd,
    onOpen,
}: {
    files: TurnFile[];
    // the agent's working directory, which a row's folder is said relative to
    cwd?: string | null;
    // opens a file in the rail, or the Diff on the whole working tree with none; left out where there is nowhere to open
    onOpen?: (path?: string) => void;
}) {
    const open = (path?: string) => (onOpen != null ? () => onOpen(path) : undefined);
    if (files.length === 1) {
        return (
            <div
                data-chat-turn-files={1}
                className="flex flex-col overflow-hidden rounded-[10px] border border-edge-mid"
            >
                <FileRow file={files[0]} cwd={cwd} onOpen={open(files[0].path)} first />
            </div>
        );
    }
    const adds = files.reduce((n, f) => n + f.adds, 0);
    const dels = files.reduce((n, f) => n + f.dels, 0);
    return (
        <div
            data-chat-turn-files={files.length}
            className="flex flex-col overflow-hidden rounded-[10px] border border-edge-mid"
        >
            <div data-chat-turn-files-head className={cn(ROW, "text-secondary")}>
                Edited {files.length} files
            </div>
            {files.map((file) => (
                <FileRow key={file.path} file={file} cwd={cwd} onOpen={open(file.path)} first={false} />
            ))}
            {onOpen != null ? (
                <Row data-chat-turn-files-all="" onOpen={open()} className="border-t border-border">
                    <span className="text-secondary">See all</span>
                    <Counts adds={adds} dels={dels} />
                </Row>
            ) : null}
        </div>
    );
}
