// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import remarkBoardPhrase from "./remarkboardphrase";

function phrases(md: string): string[] {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkBoardPhrase);
    const tree = processor.runSync(processor.parse(md)) as Root;
    const out: string[] = [];
    const walk = (node: Root | RootContent) => {
        if ((node.type as string) === "boardphrase") {
            out.push((node as any).data.hProperties.phrase);
        }
        if ("children" in node) {
            (node.children as RootContent[]).forEach(walk);
        }
    };
    walk(tree);
    return out;
}

describe("remarkBoardPhrase", () => {
    it("marks quoted phrases and dates in prose", () => {
        expect(phrases('Thoi trên board ghi "Tín hiệu feedback quá yếu?" từ 23/10.')).toEqual([
            "Tín hiệu feedback quá yếu?",
            "23/10",
        ]);
    });

    it("marks a short bold phrase and a short table cell whole, and the quotes inside them too", () => {
        expect(phrases('**Thoi "Dựng harness kiểu nào?"**')).toEqual([
            'Thoi "Dựng harness kiểu nào?"',
            "Dựng harness kiểu nào?",
        ]);
        expect(phrases("Đã chọn **tạo 1 lần, đóng băng** khi đó")).toEqual(["tạo 1 lần, đóng băng"]);
        expect(phrases("| Ngày | Việc |\n|---|---|\n| 23/10 | M4 |")).toEqual(["Ngày", "Việc", "23/10", "M4"]);
    });

    it("reads a long cell through for the quotes in it", () => {
        const cell =
            'Không. Nhánh "Sửa tín hiệu, chạy lại vòng học" bị bỏ, vì headline đã chốt theo một hướng khác hẳn';
        expect(phrases(`| a |\n|---|\n| ${cell} |`)).toEqual(["a", "Sửa tín hiệu, chạy lại vòng học"]);
    });

    it("leaves code, links and plain prose alone", () => {
        expect(phrases('`"quoted in code" 23/10`')).toEqual([]);
        expect(phrases('[link "with a quote" 23/10](https://x.y)')).toEqual([]);
        expect(phrases("không có gì để trỏ")).toEqual([]);
    });
});
