// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A rendered markdown table as clipboard content: HTML, which a spreadsheet, a doc or Notion pastes as a table with
// real cells, and a GFM Markdown table for a place that takes only text (a chat input, an agent's prompt, an editor),
// so the table survives the paste and renders again where Markdown does.
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

// a pasted doc (Google Docs, Word) draws a cell's border only from its inline style, and a bare table pastes with
// none; black 1px is a new table's own rule there. Not a theme colour: this is the pasted document's
const CELL_STYLE = "border:1px solid #000;padding:4px 8px";

function cellStyle(cell: Element): string {
    const align = cell.properties?.align;
    return typeof align === "string" && ALIGNS.has(align) ? `${CELL_STYLE};text-align:${align}` : CELL_STYLE;
}

// one cell of the Markdown text: on one line, its pipes escaped so they stay inside the cell
function mdCell(cell: Element): string {
    return cellText(cell.children).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

const DELIM: Record<string, string> = { left: ":---", right: "---:", center: ":---:" };

// GFM needs a header row: the table's own, else its first row stands in
function tableMarkdown(rows: Row[]): string {
    if (rows.length === 0) {
        return "";
    }
    const headAt = rows.findIndex((r) => r.head);
    const head = rows[headAt >= 0 ? headAt : 0];
    const body = rows.filter((r) => r !== head);
    const width = Math.max(...rows.map((r) => r.cells.length), 1);
    const line = (cells: string[]) => "| " + cells.join(" | ") + " |";
    const pad = (r: Row) => Array.from({ length: width }, (_, i) => (r.cells[i] ? mdCell(r.cells[i]) : ""));
    const delim = Array.from({ length: width }, (_, i) => {
        const align = head.cells[i]?.properties?.align;
        return (typeof align === "string" && DELIM[align]) || "---";
    });
    return [line(pad(head)), line(delim), ...body.map((r) => line(pad(r)))].join("\n");
}

export function tableClipboard(table: Element): TableClipboard {
    const rows = tableRows(table);
    const text = tableMarkdown(rows);
    const rowHtml = (r: Row) =>
        "<tr>" +
        r.cells
            .map((c) => {
                const tag = c.tagName === "th" ? "th" : "td";
                return `<${tag} style="${cellStyle(c)}">${cellHtml(c.children).trim()}</${tag}>`;
            })
            .join("") +
        "</tr>";
    const head = rows.filter((r) => r.head);
    const body = rows.filter((r) => !r.head);
    const html =
        '<meta charset="utf-8"><table style="border-collapse:collapse">' +
        (head.length > 0 ? `<thead>${head.map(rowHtml).join("")}</thead>` : "") +
        (body.length > 0 ? `<tbody>${body.map(rowHtml).join("")}</tbody>` : "") +
        "</table>";
    return { text, html };
}
