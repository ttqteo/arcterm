import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    PROTO_MAIN,
    PROTO_SCREEN_FILE,
    PROTO_SCREENS,
    PROTO_SLOT,
    PROTO_STATIC,
    protoCanvasJson,
    protoFiles,
    writeProtoTopic,
} from "./proto-fixtures.mjs";

const roots = [];
afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// each <section data-dc-screen> of a page: its name, whether it is hidden, and its slot's variant letters in order
function screensOf(html) {
    return [...html.matchAll(/<section data-dc-screen="([^"]+)"( hidden)?>([\s\S]*?)<\/section>/g)].map((m) => ({
        name: m[1],
        hidden: m[2] != null,
        slot: /data-dc-slot="([^"]+)" data-dc-slot-label="([^"]+)"/.exec(m[3])?.slice(1) ?? null,
        letters: [...m[3].matchAll(/<div data-dc-variant="([A-Z])">/g)].map((v) => v[1]),
        body: m[3],
    }));
}

describe("canvas.json", () => {
    it("holds an interactive main board, a screen that is part of it, and a static board", () => {
        const { boards } = protoCanvasJson();
        expect(Object.keys(boards)).toEqual([PROTO_MAIN, PROTO_SCREEN_FILE, PROTO_STATIC]);
        expect(boards[PROTO_MAIN].is_interactive).toBe(true);
        expect(boards[PROTO_MAIN].part_of).toBeUndefined();
        expect(boards[PROTO_SCREEN_FILE].part_of).toBe(PROTO_MAIN);
        expect(boards[PROTO_STATIC].is_interactive).toBeUndefined();
        expect(boards[PROTO_STATIC].part_of).toBeUndefined();
    });

    it("names the screen in `order` too, for a reader that must ignore it", () => {
        expect(protoCanvasJson().order).toContain(PROTO_SCREEN_FILE);
    });
});

describe("the main board", () => {
    const main = protoFiles()[PROTO_MAIN];
    const [home, later] = screensOf(main);

    it("has two screens, the first showing", () => {
        expect([home.name, later.name]).toEqual([PROTO_SCREENS.home, PROTO_SCREENS.later]);
        expect([home.hidden, later.hidden]).toEqual([false, true]);
    });

    it("carries the slot `list` labeled danh sách on both screens", () => {
        expect(home.slot).toEqual([PROTO_SLOT.id, PROTO_SLOT.label]);
        expect(later.slot).toEqual([PROTO_SLOT.id, PROTO_SLOT.label]);
        expect([PROTO_SLOT.id, PROTO_SLOT.label]).toEqual(["list", "danh sách"]);
    });

    it("gives the first screen variants A, B and C and the second only A and B", () => {
        expect(home.letters).toEqual(["A", "B", "C"]);
        expect(later.letters).toEqual(["A", "B"]);
    });

    it("draws each variant of a slot differently", () => {
        const bodies = [...home.body.matchAll(/<div data-dc-variant="[A-Z]">([\s\S]*?)<\/div>(?=<div data-dc-variant|<\/div>)/g)];
        expect(new Set(bodies.map((b) => b[1])).size).toBe(3);
        for (const l of ["A", "B", "C"]) {
            expect(main).toMatch(new RegExp(`\\[data-dc-variant="${l}"\\] \\{ background: #[0-9a-f]{6}`));
        }
    });

    it("switches screens with an inline script and a button on each", () => {
        expect(main).toContain('data-proto-go="later"');
        expect(main).toContain('data-proto-go="home"');
        expect(main).toContain("<script>");
        expect(main).not.toMatch(/<script[^>]*src=/);
        expect(main).not.toMatch(/https?:\/\//);
    });

    it("never makes a slot or a screen display: contents (the chip needs its rect)", () => {
        expect(main).not.toContain("display: contents");
    });
});

describe("the screen file and the static board", () => {
    it("holds the second screen alone, showing", () => {
        const [only, ...rest] = screensOf(protoFiles()[PROTO_SCREEN_FILE]);
        expect(rest).toEqual([]);
        expect(only.name).toBe(PROTO_SCREENS.later);
        expect(only.hidden).toBe(false);
    });

    it("has no screen and no slot", () => {
        const html = protoFiles()[PROTO_STATIC];
        expect(html).not.toContain("data-dc-screen=");
        expect(html).not.toContain("data-dc-slot=");
        expect(html).not.toContain("data-dc-variant=");
    });
});

describe("writeProtoTopic", () => {
    it("writes canvas.json and every board under .superpowers/design/<topic>/project", () => {
        const cwd = mkdtempSync(join(tmpdir(), "proto-fixtures-test-"));
        roots.push(cwd);
        const { dir, project } = writeProtoTopic(cwd, "verify-proto");
        expect(dir).toBe(join(cwd, ".superpowers", "design", "verify-proto"));
        expect(project).toBe(join(dir, "project"));
        expect(JSON.parse(readFileSync(join(project, "canvas.json"), "utf8"))).toEqual(protoCanvasJson());
        for (const name of [PROTO_MAIN, PROTO_SCREEN_FILE, PROTO_STATIC]) {
            expect(existsSync(join(project, name))).toBe(true);
        }
        expect(readFileSync(join(project, PROTO_MAIN), "utf8")).toBe(protoFiles()[PROTO_MAIN]);
    });
});
