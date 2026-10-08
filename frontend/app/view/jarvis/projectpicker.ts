// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a project sits, for the New launcher's project column: the "where" beside each name is what tells two
// same-named checkouts apart.

// The home folder from a FileInfoCommand stat of "~". The server expands "~" to stat it but hands the
// path back re-collapsed (ReplaceHomeDir turns home itself into "~"), so home is rebuilt from the
// expanded parent `dir` plus `name`. Anything else is "unknown", which makes projectWhere show full paths.
export function homeFromInfo(info: FileInfo | null | undefined): string {
    if (info == null || info.notfound) {
        return "";
    }
    const path = info.path ?? "";
    if (path !== "" && !path.startsWith("~")) {
        return path;
    }
    if (path === "~" && info.dir && info.name) {
        return info.dir.replace(/[\\/]+$/, "") + "/" + info.name;
    }
    return "";
}

function splitPath(p: string): { lead: string; segs: string[]; sep: string } {
    const lead = /^[\\/]*/.exec(p)[0];
    return {
        lead,
        segs: p
            .slice(lead.length)
            .split(/[\\/]+/)
            .filter((s) => s !== ""),
        sep: p.includes("\\") ? "\\" : "/",
    };
}

// Windows paths compare case-insensitively, which is also what makes `c:\` and `C:\` one drive.
function sameSegs(a: string[], b: string[], fold: boolean): boolean {
    return a.length === b.length && a.every((s, i) => (fold ? s.toLowerCase() === b[i].toLowerCase() : s === b[i]));
}

// The parent folder of a project: relative to home when inside it, else the full parent path. A project
// directly in home says "~", because a blank there would read as "unknown" rather than "home".
export function projectWhere(path: string, home: string): string {
    const p = splitPath(path);
    const parent = p.segs.slice(0, -1);
    if (home !== "") {
        const h = splitPath(home);
        const fold = /^[a-z]:$/i.test(h.segs[0] ?? "");
        if (sameSegs(p.segs, h.segs, fold)) {
            return "";
        }
        if (parent.length >= h.segs.length && sameSegs(parent.slice(0, h.segs.length), h.segs, fold)) {
            const rel = parent.slice(h.segs.length);
            return rel.length === 0 ? "~" : rel.join(p.sep);
        }
    }
    const full = p.lead + parent.join(p.sep);
    // a bare drive is not a folder until it has its separator back
    return /^[a-z]:$/i.test(full) ? full + p.sep : full;
}
