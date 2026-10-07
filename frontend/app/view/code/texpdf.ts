// frontend/app/view/code/texpdf.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the line under a .tex file's PDF mode. The PDF is whatever was built last, never compiled for the view,
// so the line says how old it is and which build it is: it can be behind the source on screen.

import { formatAgo } from "@/app/view/agents/agentsviewmodel";

function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

export function texPdfMeta(found: CommandDocPdfFindRtnData, now: number): string {
    const parts = [baseName(found.pdfpath ?? "")];
    if (found.modtime != null && found.modtime > 0) {
        parts.push(`built ${formatAgo(Math.max(0, now - found.modtime))}`);
    }
    parts.push(`from ${baseName(found.rootpath)}`);
    if (found.source === "compiled") {
        parts.push("Doc review build");
    }
    return parts.join(" · ");
}
