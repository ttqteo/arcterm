// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";

// the folder truncates and the file name never does: paths here mostly start with the same home prefix,
// so a plain tail ellipsis hid the one part that tells two rows apart
export function PathTail({ path, className }: { path: string; className?: string }) {
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
    const style = cn("flex min-w-0 text-[10.5px] text-muted", className);
    // with no folder there is nothing to give up first, so the name itself truncates
    if (cut === 0) {
        return (
            <span title={path} className={style}>
                <span className="truncate">{path}</span>
            </span>
        );
    }
    return (
        <span title={path} className={style}>
            <span className="truncate">{path.slice(0, cut)}</span>
            <span className="flex-none">{path.slice(cut)}</span>
        </span>
    );
}
