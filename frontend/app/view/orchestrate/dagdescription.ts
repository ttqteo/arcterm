// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The peek's glance at a task description. About half the real plans open straight on **Files:**, so
// those lead with the files the task touches instead of a bare label. Returns markdown source: InlineMarkdown
// renders it, as Markdown renders the full description the peek expands to.

export const LEAD_FILES_MAX = 4;

export type DescBlock = { kind: "p" | "h" | "li" | "code"; depth: number; text: string; check: "" | "done" | "open" };

const INDENT = 2;

export function descriptionBlocks(src: string | undefined): DescBlock[] {
    const blocks: DescBlock[] = [];
    let para: DescBlock | null = null;
    let fence: DescBlock | null = null;
    const flush = () => {
        if (para) blocks.push(para);
        para = null;
    };
    for (const line of (src ?? "").replace(/\r/g, "").split("\n")) {
        if (fence) {
            if (/^\s*```/.test(line)) {
                blocks.push(fence);
                fence = null;
            } else fence.text += (fence.text ? "\n" : "") + line;
            continue;
        }
        const f = line.match(/^(\s*)```/);
        if (f) {
            flush();
            fence = { kind: "code", depth: Math.floor(f[1].length / INDENT), text: "", check: "" };
            continue;
        }
        if (!line.trim()) {
            flush();
            continue;
        }
        const h = line.match(/^#{1,6}\s+(.*)/);
        if (h) {
            flush();
            blocks.push({ kind: "h", depth: 0, text: h[1], check: "" });
            continue;
        }
        const li = line.match(/^(\s*)([-*]|\d+\.)\s+(\[[ xX]\]\s+)?(.*)/);
        if (li) {
            flush();
            const check = li[3] ? (/x/i.test(li[3]) ? "done" : "open") : "";
            para = { kind: "li", depth: Math.floor(li[1].length / INDENT), text: li[4], check };
            continue;
        }
        if (para && (para.kind === "p" || /^\s/.test(line))) {
            para.text += " " + line.trim();
            continue;
        }
        flush();
        para = { kind: "p", depth: 0, text: line.trim(), check: "" };
    }
    flush();
    if (fence) blocks.push(fence);
    return blocks;
}

const isLabel = (b: DescBlock) => b.kind === "p" && /^\*\*[^*]+:\*\*$/.test(b.text.trim());
const isFiles = (b: DescBlock) => b.kind === "p" && /^\*\*Files:\*\*$/.test(b.text.trim());

export function descriptionLead(src: string | undefined): { lead: string; more: boolean } {
    const blocks = descriptionBlocks(src);
    const more = blocks.length > 1;
    const prose = blocks.findIndex((b) => b.kind === "p" && !isLabel(b));
    const files = blocks.findIndex(isFiles);
    if (files < 0 || (prose >= 0 && prose < files)) return { lead: prose >= 0 ? blocks[prose].text : "", more };
    const paths: string[] = [];
    for (let i = files + 1; i < blocks.length && blocks[i].kind === "li" && !blocks[i].check; i++) {
        const m = blocks[i].text.match(/`([^`]+)`/);
        if (m && blocks[i].depth === 0) paths.push(m[1]);
    }
    if (paths.length === 0) return { lead: prose >= 0 ? blocks[prose].text : "", more };
    const shown = paths
        .slice(0, LEAD_FILES_MAX)
        .map((p) => `\`${p}\``)
        .join(", ");
    const rest = paths.length > LEAD_FILES_MAX ? ` +${paths.length - LEAD_FILES_MAX} more` : "";
    return { lead: `Touches ${shown}${rest}`, more };
}
