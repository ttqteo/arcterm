// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A rendered markdown table as clipboard content: HTML, which a spreadsheet, a doc or Notion pastes as a table with
// real cells, and tab-separated text for a place that takes only text (a spreadsheet still splits it into cells).
// Read from the table's hast node, so the copy holds the cells and none of the view's styling: a dark theme's
// colours never land in a pasted document.

import type { Element, ElementContent } from "hast";

export type TableClipboard = { text: string; html: string };

type Row = { head: boolean; cells: Element[] };

// inline formatting a pasted cell keeps; any other element gives way to its contents
const KEPT = new Set(["strong", "b", "em", "i", "code", "del", "s"]);
const SECTIONS = new Set(["thead", "tbody", "tfoot"]);
const ALIGNS = new Set(["left", "right", "center"]);
// a link keeps its target only where a pasted document can open it
const PASTED_HREF = /^(https?:|mailto:)/i;

// the table's own rows: a table nested in a cell (raw HTML) stays that cell's content
function tableRows(table: Element): Row[] {
    const out: Row[] = [];
    const walk = (node: Element, head: boolean) => {
        for (const child of node.children) {
            if (child.type !== "element") {
                continue;
            }
            if (child.tagName === "tr") {
                const cells = child.children.filter(
                    (c): c is Element => c.type === "element" && (c.tagName === "th" || c.tagName === "td")
                );
                out.push({ head, cells });
            } else if (SECTIONS.has(child.tagName)) {
                walk(child, child.tagName === "thead");
            }
        }
    };
    walk(table, false);
    return out;
}

function cellText(nodes: ElementContent[]): string {
    return nodes
        .map((n) => {
            if (n.type === "text") {
                return n.value;
            }
            if (n.type === "element") {
                return n.tagName === "br" ? " " : cellText(n.children);
            }
            return "";
        })
        .join("");
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cellHtml(nodes: ElementContent[]): string {
    return nodes
        .map((n) => {
            if (n.type === "text") {
                return escapeHtml(n.value);
            }
            if (n.type !== "element") {
                return "";
            }
            const inner = cellHtml(n.children);
            if (n.tagName === "br") {
                return "<br>";
            }
            if (KEPT.has(n.tagName)) {
                return `<${n.tagName}>${inner}</${n.tagName}>`;
            }
            const href = n.tagName === "a" ? n.properties?.href : null;
            if (typeof href === "string" && PASTED_HREF.test(href)) {
                return `<a href="${escapeHtml(href)}">${inner}</a>`;
            }
            return inner;
        })
        .join("");
}

function alignStyle(cell: Element): string {
    const align = cell.properties?.align;
    return typeof align === "string" && ALIGNS.has(align) ? ` style="text-align:${align}"` : "";
}

export function tableClipboard(table: Element): TableClipboard {
    const rows = tableRows(table);
    const text = rows
        .map((r) => r.cells.map((c) => cellText(c.children).replace(/\s+/g, " ").trim()).join("\t"))
        .join("\n");
    const rowHtml = (r: Row) =>
        "<tr>" +
        r.cells
            .map((c) => {
                const tag = c.tagName === "th" ? "th" : "td";
                return `<${tag}${alignStyle(c)}>${cellHtml(c.children).trim()}</${tag}>`;
            })
            .join("") +
        "</tr>";
    const head = rows.filter((r) => r.head);
    const body = rows.filter((r) => !r.head);
    const html =
        '<meta charset="utf-8"><table>' +
        (head.length > 0 ? `<thead>${head.map(rowHtml).join("")}</thead>` : "") +
        (body.length > 0 ? `<tbody>${body.map(rowHtml).join("")}</tbody>` : "") +
        "</table>";
    return { text, html };
}
