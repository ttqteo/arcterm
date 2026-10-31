// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { tableClipboard } from "./markdown-table";

// the hast remark-gfm + remark-rehype produce: newline text nodes between rows and cells, align on each cell
function h(tagName: string, properties: Record<string, unknown>, ...children: (ElementContent | string)[]): Element {
    return {
        type: "element",
        tagName,
        properties: properties as Element["properties"],
        children: children.map((c) => (typeof c === "string" ? { type: "text", value: c } : c)),
    };
}

const NL = "\n";

function gfmTable(): Element {
    return h(
        "table",
        {},
        NL,
        h(
            "thead",
            {},
            NL,
            h("tr", {}, NL, h("th", { align: "left" }, "Task"), NL, h("th", { align: "right" }, "Mean time"), NL),
            NL
        ),
        NL,
        h(
            "tbody",
            {},
            NL,
            h(
                "tr",
                {},
                NL,
                h("td", { align: "left" }, "T1 Start as a guest"),
                NL,
                h("td", { align: "right" }, "48 s"),
                NL
            ),
            NL,
            h(
                "tr",
                {},
                NL,
                h("td", { align: "left" }, "T2 Finish a lesson"),
                NL,
                h("td", { align: "right" }, "222 s"),
                NL
            ),
            NL
        ),
        NL
    );
}

describe("tableClipboard", () => {
    it("copies the cells as tab-separated rows, header first", () => {
        expect(tableClipboard(gfmTable()).text).toBe(
            "Task\tMean time\nT1 Start as a guest\t48 s\nT2 Finish a lesson\t222 s"
        );
    });

    it("copies the HTML table a spreadsheet or doc pastes as cells, keeping each column's alignment", () => {
        expect(tableClipboard(gfmTable()).html).toBe(
            '<meta charset="utf-8"><table>' +
                '<thead><tr><th style="text-align:left">Task</th><th style="text-align:right">Mean time</th></tr></thead>' +
                "<tbody>" +
                '<tr><td style="text-align:left">T1 Start as a guest</td><td style="text-align:right">48 s</td></tr>' +
                '<tr><td style="text-align:left">T2 Finish a lesson</td><td style="text-align:right">222 s</td></tr>' +
                "</tbody></table>"
        );
    });

    it("keeps inline formatting in the HTML and drops it from the text", () => {
        const t = h(
            "table",
            {},
            h(
                "tbody",
                {},
                h("tr", {}, h("td", {}, h("strong", {}, "bold"), " and ", h("code", {}, "code"), h("br", {}), "next"))
            )
        );
        const out = tableClipboard(t);
        expect(out.html).toContain("<td><strong>bold</strong> and <code>code</code><br>next</td>");
        expect(out.text).toBe("bold and code next");
    });

    it("escapes cell text so it pastes as text, not markup", () => {
        const t = h("table", {}, h("tbody", {}, h("tr", {}, h("td", {}, 'a < b & "c"'))));
        expect(tableClipboard(t).html).toContain("<td>a &lt; b &amp; &quot;c&quot;</td>");
    });

    it("keeps a web link and unwraps a link a pasted document cannot open", () => {
        const t = h(
            "table",
            {},
            h(
                "tbody",
                {},
                h(
                    "tr",
                    {},
                    h("td", {}, h("a", { href: "https://example.com/?a=1&b=2" }, "web")),
                    h("td", {}, h("a", { href: "javascript:alert(1)" }, "script")),
                    h("td", {}, h("a", { href: "./notes.md" }, "local"))
                )
            )
        );
        const out = tableClipboard(t);
        expect(out.html).toContain('<td><a href="https://example.com/?a=1&amp;b=2">web</a></td>');
        expect(out.html).toContain("<td>script</td>");
        expect(out.html).toContain("<td>local</td>");
        expect(out.text).toBe("web\tscript\tlocal");
    });

    it("folds tabs and line breaks inside a cell so it stays one cell of the text", () => {
        const t = h("table", {}, h("tbody", {}, h("tr", {}, h("td", {}, "a\tb\nc  d"), h("td", {}, "e"))));
        expect(tableClipboard(t).text).toBe("a b c d\te");
    });

    it("reads a raw HTML table with rows straight under it, and keeps a nested table as its cell's content", () => {
        const nested = h("table", {}, h("tr", {}, h("td", {}, "inner")));
        const t = h("table", {}, h("tr", {}, h("th", {}, "outer")), h("tr", {}, h("td", {}, nested)));
        const out = tableClipboard(t);
        expect(out.text).toBe("outer\ninner");
        expect(out.html).toBe(
            '<meta charset="utf-8"><table><tbody><tr><th>outer</th></tr><tr><td>inner</td></tr></tbody></table>'
        );
    });
});
