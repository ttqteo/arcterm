// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Picks a Material Icon Theme icon (the VS Code theme's set) for a file or folder, from the theme's own
// manifest so the choice matches what VS Code shows. Pure: it returns an icon name, and fileicon.tsx
// turns the name into an image. Named imports so the build drops the manifest's unused tables.

import {
    file as defaultFile,
    folder as defaultFolder,
    folderExpanded as defaultFolderExpanded,
    fileExtensions,
    fileNames,
    folderNames,
    folderNamesExpanded,
} from "material-icon-theme/dist/material-icons.json";

const extMap = fileExtensions as Record<string, string>;
const nameMap = fileNames as Record<string, string>;
const folderMap = folderNames as Record<string, string>;
const folderOpenMap = folderNamesExpanded as Record<string, string>;

// a few file names are scoped to a parent ("src/bashly-strings.yaml", ".config/stylelintrc"), which
// only a path can match
const scopedNames = Object.keys(nameMap).filter((k) => k.includes("/"));

// own keys only: a file named "constructor" must not find Object.prototype's
function own(map: Record<string, string>, key: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function lookup(map: Record<string, string>, key: string): string | undefined {
    return own(map, key) ?? own(map, key.toLowerCase());
}

// `path` is repo-relative with forward slashes; a bare name works too
export function fileIconName(path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const byName = lookup(nameMap, name);
    if (byName != null) {
        return byName;
    }
    const lower = path.toLowerCase();
    for (const k of scopedNames) {
        if (lower === k || lower.endsWith(`/${k}`)) {
            return nameMap[k];
        }
    }
    // longest compound extension first, so foo.spec.ts is a test file before it is TypeScript
    for (let i = name.indexOf("."); i !== -1; i = name.indexOf(".", i + 1)) {
        const byExt = lookup(extMap, name.slice(i + 1));
        if (byExt != null) {
            return byExt;
        }
    }
    return defaultFile;
}

export function folderIconName(path: string, expanded: boolean): string {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return lookup(expanded ? folderOpenMap : folderMap, name) ?? (expanded ? defaultFolderExpanded : defaultFolder);
}
