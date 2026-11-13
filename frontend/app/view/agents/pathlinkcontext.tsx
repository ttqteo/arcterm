// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agent a transcript belongs to, for its file path links. A transcript with no agent around it (a session read
// from disk on its own) has no provider, and its paths stay plain text.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/app/store/global";
import { revealLabel } from "@/app/view/code/pathactions";
import { cn, fireAndForget } from "@/util/util";
import { Copy, FileText, FolderOpen } from "lucide-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { openAgentPath, revealAgentPath } from "./pathlinkroute";

export interface PathOpener {
    open: (path: string, line?: number) => void;
    // the file selected in Finder / Explorer
    reveal: (path: string) => void;
}

const PathLinkContext = createContext<PathOpener | null>(null);

// the opener a path link calls, or null with no agent around: for a piece that opens a file but is not a link (a file card)
export function usePathOpener(): PathOpener | null {
    return useContext(PathLinkContext);
}

export function AgentPathLinks({ agent, children }: { agent: AgentVM; children: ReactNode }) {
    const opener = useMemo<PathOpener>(
        () => ({
            open: (path, line) => fireAndForget(() => openAgentPath(agent, path, line)),
            reveal: (path) => fireAndForget(() => revealAgentPath(agent, path)),
        }),
        [agent]
    );
    return <PathLinkContext.Provider value={opener}>{children}</PathLinkContext.Provider>;
}

// a path as a link when an agent is in context, else its children as they are. Its right-click menu, in place of the
// message's: open it beside the agent, show it in the file manager, copy the path as written
export function PathLink({
    path,
    line,
    className,
    children,
}: {
    path: string;
    line?: number;
    className?: string;
    children: ReactNode;
}) {
    const opener = usePathOpener();
    if (opener == null) {
        return <span className={className}>{children}</span>;
    }
    return (
        <button
            type="button"
            data-path-link={path}
            title={`Open ${path}${line != null ? `:${line}` : ""} beside the agent`}
            onClick={(e) => {
                // the row around it opens the tool detail
                e.stopPropagation();
                opener.open(path, line);
            }}
            onContextMenu={(e) =>
                ContextMenuModel.getInstance().showContextMenu(
                    [
                        {
                            label: "Open beside the agent",
                            icon: <FileText size={15} />,
                            click: () => opener.open(path, line),
                        },
                        {
                            label: revealLabel(getApi().getPlatform()),
                            icon: <FolderOpen size={15} />,
                            click: () => opener.reveal(path),
                        },
                        { type: "separator" },
                        {
                            label: "Copy path",
                            icon: <Copy size={15} />,
                            click: () => void navigator.clipboard?.writeText(path),
                        },
                    ],
                    e
                )
            }
            className={cn(
                "min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left hover:text-accent-soft hover:underline",
                className
            )}
        >
            {children}
        </button>
    );
}
