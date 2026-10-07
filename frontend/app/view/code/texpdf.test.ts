// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { texPdfMeta } from "./texpdf";

const NOW = 1_800_000_000_000;

describe("texPdfMeta", () => {
    it("names the PDF, its age and the root it came from", () => {
        const meta = texPdfMeta(
            {
                rootpath: "D:\\p\\main.tex",
                pdfpath: "D:\\p\\main.pdf",
                source: "sibling",
                modtime: NOW - 2 * 3_600_000,
            },
            NOW
        );
        expect(meta).toBe("main.pdf · built 2h ago · from main.tex");
    });

    it("says when the PDF is the Doc review's build", () => {
        const meta = texPdfMeta(
            {
                rootpath: "/p/main.tex",
                pdfpath: "/data/doccompile/abc/main.pdf",
                source: "compiled",
                modtime: NOW - 1000,
            },
            NOW
        );
        expect(meta).toBe("main.pdf · built just now · from main.tex · Doc review build");
    });

    it("leaves the age out when the modtime is unknown", () => {
        expect(texPdfMeta({ rootpath: "/p/main.tex", pdfpath: "/p/main.pdf", source: "sibling" }, NOW)).toBe(
            "main.pdf · from main.tex"
        );
    });
});
