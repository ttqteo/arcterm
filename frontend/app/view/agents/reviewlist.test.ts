// frontend/app/view/agents/reviewlist.test.ts
import { describe, expect, it } from "vitest";
import { FOLD_CONTEXT, ReviewRow, ReviewSection, reviewSections, rowsInRange } from "./reviewlist";

const NONE: ReadonlySet<string> = new Set();

// a full-context patch: one hunk holding the whole file
function patch(path: string, header: string, body: string[], extra: string[] = []): string {
    return (
        [`diff --git a/${path} b/${path}`, ...extra, `--- a/${path}`, `+++ b/${path}`, header, ...body].join("\n") +
        "\n"
    );
}

function ctx(from: number, to: number): string[] {
    const out: string[] = [];
    for (let i = from; i <= to; i++) {
        out.push(` line ${i}`);
    }
    return out;
}

function lineKeys(s: ReviewSection): string[] {
    return s.rows.map((r) => (r.kind === "line" ? r.key : `fold:${r.hidden}`));
}

function one(files: Parameters<typeof reviewSections>[0], expanded: ReadonlySet<string> = NONE): ReviewSection {
    const sections = reviewSections(files, expanded);
    expect(sections).toHaveLength(1);
    return sections[0];
}

describe("reviewSections", () => {
    it("a modified file's rows carry their side, line numbers and change, and the header counts", () => {
        const diff = patch("src/x.ts", "@@ -1,4 +1,4 @@", [" a", "-b", "+B", "+B2", " c"]);
        const s = one([{ path: "src/x.ts", diff }]);
        expect(s.adds).toBe(2);
        expect(s.dels).toBe(1);
        expect(s.empty).toBeUndefined();
        expect(s.rows).toEqual<ReviewRow[]>([
            {
                kind: "line",
                key: "new:1",
                side: "new",
                line: 1,
                oldNo: "1",
                newNo: "1",
                sign: "",
                text: "a",
                change: "ctx",
            },
            {
                kind: "line",
                key: "old:2",
                side: "old",
                line: 2,
                oldNo: "2",
                newNo: "",
                sign: "−",
                text: "b",
                change: "del",
            },
            {
                kind: "line",
                key: "new:2",
                side: "new",
                line: 2,
                oldNo: "",
                newNo: "2",
                sign: "+",
                text: "B",
                change: "add",
            },
            {
                kind: "line",
                key: "new:3",
                side: "new",
                line: 3,
                oldNo: "",
                newNo: "3",
                sign: "+",
                text: "B2",
                change: "add",
            },
            {
                kind: "line",
                key: "new:4",
                side: "new",
                line: 4,
                oldNo: "3",
                newNo: "4",
                sign: "",
                text: "c",
                change: "ctx",
            },
        ]);
    });

    it("hunk headers are not rows", () => {
        const diff = patch("x.ts", "@@ -1,1 +1,1 @@", ["-a", "+b"]);
        const s = one([{ path: "x.ts", diff }]);
        expect(s.rows.every((r) => r.kind === "line" && !r.text.startsWith("@@"))).toBe(true);
        expect(s.rows).toHaveLength(2);
    });

    it("an added file is all new-side rows", () => {
        const diff = patch("n.ts", "@@ -0,0 +1,2 @@", ["+one", "+two"], ["new file mode 100644"]);
        const s = one([{ path: "n.ts", diff }]);
        expect(lineKeys(s)).toEqual(["new:1", "new:2"]);
        expect(s.adds).toBe(2);
        expect(s.dels).toBe(0);
    });

    it("an untracked file is all new-side rows from its content", () => {
        const s = one([{ path: "u.ts", untracked: true, content: "one\ntwo\nthree\n" }]);
        expect(lineKeys(s)).toEqual(["new:1", "new:2", "new:3"]);
        expect(s.rows.every((r) => r.kind === "line" && r.change === "add" && r.side === "new")).toBe(true);
        expect(s.adds).toBe(3);
    });

    it("a removed file is all old-side rows", () => {
        const diff = patch("gone.ts", "@@ -1,2 +0,0 @@", ["-one", "-two"], ["deleted file mode 100644"]);
        const s = one([{ path: "gone.ts", diff }]);
        expect(lineKeys(s)).toEqual(["old:1", "old:2"]);
        expect(s.rows.every((r) => r.kind === "line" && r.side === "old" && r.change === "del")).toBe(true);
        expect(s.dels).toBe(2);
    });

    it("a long unchanged run in the middle folds to 3 rows on each side and expands by its id", () => {
        // 1 change, 20 unchanged, 1 change
        const body = ["-x", "+X", ...ctx(2, 21), "-y", "+Y"];
        const diff = patch("m.ts", "@@ -1,22 +1,22 @@", body);
        const s = one([{ path: "m.ts", diff }]);
        const keys = lineKeys(s);
        expect(keys).toEqual([
            "old:1",
            "new:1",
            "new:2",
            "new:3",
            "new:4",
            "fold:14",
            "new:19",
            "new:20",
            "new:21",
            "old:22",
            "new:22",
        ]);
        const fold = s.rows.find((r) => r.kind === "fold");
        expect(fold?.kind).toBe("fold");
        const open = one([{ path: "m.ts", diff }], new Set([(fold as { id: string }).id]));
        expect(open.rows.some((r) => r.kind === "fold")).toBe(false);
        expect(open.rows).toHaveLength(24);
    });

    it("runs at the file's start and end fold with 3 rows on their inner side", () => {
        const body = [...ctx(1, 10), "-x", "+X", ...ctx(12, 21)];
        const diff = patch("e.ts", "@@ -1,21 +1,21 @@", body);
        const s = one([{ path: "e.ts", diff }]);
        expect(lineKeys(s)).toEqual([
            "fold:7",
            "new:8",
            "new:9",
            "new:10",
            "old:11",
            "new:11",
            "new:12",
            "new:13",
            "new:14",
            "fold:7",
        ]);
        const folds = s.rows.filter((r) => r.kind === "fold") as { id: string }[];
        expect(new Set(folds.map((f) => f.id)).size).toBe(2);
        const open = one([{ path: "e.ts", diff }], new Set([folds[0].id]));
        expect(lineKeys(open)[0]).toBe("new:1");
        expect(lineKeys(open).at(-1)).toBe("fold:7");
    });

    it(`a run of exactly ${2 * FOLD_CONTEXT + 1} does not fold, in the middle or at an edge`, () => {
        const body = [...ctx(1, 7), "-x", "+X", ...ctx(9, 15), "-y", "+Y", ...ctx(17, 23)];
        const diff = patch("s.ts", "@@ -1,23 +1,23 @@", body);
        const s = one([{ path: "s.ts", diff }]);
        expect(s.rows.some((r) => r.kind === "fold")).toBe(false);
        expect(s.rows).toHaveLength(25);
    });

    it("fold ids differ between files", () => {
        const body = ["-x", "+X", ...ctx(2, 21)];
        const a = patch("a.ts", "@@ -1,21 +1,21 @@", body);
        const b = patch("b.ts", "@@ -1,21 +1,21 @@", body);
        const [sa, sb] = reviewSections(
            [
                { path: "a.ts", diff: a },
                { path: "b.ts", diff: b },
            ],
            NONE
        );
        const fa = sa.rows.find((r) => r.kind === "fold") as { id: string };
        const fb = sb.rows.find((r) => r.kind === "fold") as { id: string };
        expect(fa.id).not.toBe(fb.id);
        const [oa, ob] = reviewSections(
            [
                { path: "a.ts", diff: a },
                { path: "b.ts", diff: b },
            ],
            new Set([fa.id])
        );
        expect(oa.rows.some((r) => r.kind === "fold")).toBe(false);
        expect(ob.rows.some((r) => r.kind === "fold")).toBe(true);
    });

    it("a patch with more than one hunk folds each hunk on its own", () => {
        const diff =
            patch("h.ts", "@@ -1,9 +1,9 @@", ["-x", "+X", ...ctx(2, 9)]).trimEnd() +
            "\n" +
            ["@@ -40,9 +40,9 @@", ...ctx(40, 47), "-y", "+Y"].join("\n") +
            "\n";
        const s = one([{ path: "h.ts", diff }]);
        expect(lineKeys(s)).toEqual([
            "old:1",
            "new:1",
            "new:2",
            "new:3",
            "new:4",
            "fold:5",
            "fold:5",
            "new:45",
            "new:46",
            "new:47",
            "old:48",
            "new:48",
        ]);
        const folds = s.rows.filter((r) => r.kind === "fold") as { id: string }[];
        expect(new Set(folds.map((f) => f.id)).size).toBe(2);
    });

    it("a binary file has no rows and says so", () => {
        const diff =
            ["diff --git a/i.png b/i.png", "index 1..2 100644", "Binary files a/i.png and b/i.png differ"].join("\n") +
            "\n";
        const s = one([{ path: "img/i.png", diff }]);
        expect(s.empty).toBe("binary");
        expect(s.rows).toEqual([]);
    });

    it("a file too large has no rows and carries its size", () => {
        const s = one([{ path: "big.json", toolarge: true, size: 9_000_000 }]);
        expect(s.empty).toBe("toolarge");
        expect(s.size).toBe(9_000_000);
        expect(s.rows).toEqual([]);
    });

    it("a pure rename has no rows and keeps its old path", () => {
        const diff =
            [
                "diff --git a/old/r.ts b/new/r.ts",
                "similarity index 100%",
                "rename from old/r.ts",
                "rename to new/r.ts",
            ].join("\n") + "\n";
        const s = one([{ path: "new/r.ts", oldpath: "old/r.ts", diff }]);
        expect(s.empty).toBe("renamed");
        expect(s.oldPath).toBe("old/r.ts");
        expect(s.rows).toEqual([]);
    });

    it("a file with no text and no reason says nochange", () => {
        const diff = ["diff --git a/m.sh b/m.sh", "old mode 100644", "new mode 100755"].join("\n") + "\n";
        expect(one([{ path: "m.sh", diff }]).empty).toBe("nochange");
    });

    it("splits the path into name and dir", () => {
        const [deep, root] = reviewSections(
            [
                { path: "frontend/app/view/x.tsx", untracked: true, content: "a\n" },
                { path: "README.md", untracked: true, content: "a\n" },
            ],
            NONE
        );
        expect([deep.name, deep.dir]).toEqual(["x.tsx", "frontend/app/view"]);
        expect([root.name, root.dir]).toEqual(["README.md", ""]);
        expect(deep.path).toBe("frontend/app/view/x.tsx");
    });

    it("keeps the files' order", () => {
        const paths = reviewSections(
            [
                { path: "b.ts", untracked: true, content: "a\n" },
                { path: "a.ts", untracked: true, content: "a\n" },
            ],
            NONE
        ).map((s) => s.path);
        expect(paths).toEqual(["b.ts", "a.ts"]);
    });
});

describe("rowsInRange", () => {
    const diff = patch("r.ts", "@@ -1,5 +1,5 @@", [" a", "-b", "-c", "+B", "+C", " d", " e"]);
    const s = one([{ path: "r.ts", diff }]);
    const texts = (rows: ReviewRow[] | null) => rows?.map((r) => (r.kind === "line" ? r.text : "fold"));

    it("returns a side's rows between two keys, in either order", () => {
        expect(texts(rowsInRange(s, "new:1", "new:3"))).toEqual(["a", "B", "C"]);
        expect(texts(rowsInRange(s, "new:3", "new:1"))).toEqual(["a", "B", "C"]);
        expect(texts(rowsInRange(s, "old:2", "old:3"))).toEqual(["b", "c"]);
        expect(texts(rowsInRange(s, "new:4", "new:4"))).toEqual(["d"]);
    });

    it("is null across sides or for a key not in the section", () => {
        expect(rowsInRange(s, "new:1", "old:2")).toBeNull();
        expect(rowsInRange(s, "new:1", "new:99")).toBeNull();
    });
});
