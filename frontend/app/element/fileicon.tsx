// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Material Icon Theme file and folder icons. They are colored image assets, not lucide glyphs, so they
// render as <img>. The glob only collects URLs: vite.config.ts keeps every icon out of the inline
// limit, so each one is its own small file the browser fetches and caches when a row first shows it.

import { cn } from "@/util/util";
import { fileIconName, folderIconName } from "./fileicontheme";

const urls = import.meta.glob("../../../node_modules/material-icon-theme/icons/*.svg", {
    eager: true,
    query: "?url",
    import: "default",
}) as unknown as Record<string, string>;

const iconUrl = new Map<string, string>();
for (const [path, url] of Object.entries(urls)) {
    iconUrl.set(path.slice(path.lastIndexOf("/") + 1, -".svg".length), url);
}

export function FileIcon({
    path,
    dir,
    expanded = false,
    size = 16,
    className,
}: {
    path: string;
    dir?: boolean;
    expanded?: boolean;
    size?: number;
    className?: string;
}) {
    const name = dir ? folderIconName(path, expanded) : fileIconName(path);
    const src = iconUrl.get(name) ?? iconUrl.get(dir ? "folder" : "file");
    return (
        <img
            src={src}
            alt=""
            aria-hidden
            draggable={false}
            width={size}
            height={size}
            className={cn("flex-none select-none", className)}
        />
    );
}
