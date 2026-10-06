// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agent a transcript belongs to, for its file path links. A transcript with no agent around it (a session read
// from disk on its own) has no provider, and its paths stay plain text.

import { cn, fireAndForget } from "@/util/util";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { openAgentPath } from "./pathlinkroute";

export interface PathOpener {
    open: (path: string, line?: number) => void;
}

const PathLinkContext = createContext<PathOpener | null>(null);

export function AgentPathLinks({ agent, children }: { agent: AgentVM; children: ReactNode }) {
    const opener = useMemo<PathOpener>(
        () => ({ open: (path, line) => fireAndForget(() => openAgentPath(agent, path, line)) }),
        [agent]
    );
    return <PathLinkContext.Provider value={opener}>{children}</PathLinkContext.Provider>;
}

// a path as a link when an agent is in context, else its children as they are
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
    const opener = useContext(PathLinkContext);
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
            className={cn(
                "min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left hover:text-accent-soft hover:underline",
                className
            )}
        >
            {children}
        </button>
    );
}
