// frontend/app/view/agents/gitdiff.test.ts
import { describe, expect, it } from "vitest";
import { diffFileView, firstChangedLine, parseUnifiedDiff, plainFileView } from "./gitdiff";

const DIFF = [
    "diff --git a/src/x.ts b/src/x.ts",
    "index 111..222 100644",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    "@@ -10,3 +10,4 @@ createSession",
    " ctx line",
    "-old line",
    "+new line",
    "+added line",
].join("\n");

describe("parseUnifiedDiff", () => {
    it("drops file headers and parses the hunk header", () => {
        const v = parseUnifiedDiff(DIFF);
        expect(v.isDiff).toBe(true);
        expect(v.hunkLabel).toBe("@@ -10,3 +10,4 @@ createSession");
        expect(v.lines.some((l) => l.text.startsWith("diff --git"))).toBe(false);
    });

    // git always terminates its output with a newline; the fixture above deliberately does not, so the
    // gutter assertions below would never have caught the blank row that trailing newline used to add.
    it("drops the phantom blank line git's trailing newline leaves behind", () => {
        const v = parseUnifiedDiff(DIFF + "\n");
        const body = v.lines.filter((l) => l.kind !== "hunk");
        expect(body[body.length - 1].text).toBe("added line");
        expect(body.map((l) => [l.gOld, l.gNew, l.sign, l.text])).toEqual([
            ["10", "10", "", "ctx line"],
            ["11", "", "−", "old line"],
            ["", "11", "+", "new line"],
            ["", "12", "+", "added line"],
        ]);
    });

    it("tracks old/new gutters and counts adds/dels", () => {
        const v = parseUnifiedDiff(DIFF);
        const body = v.lines.filter((l) => l.kind !== "hunk");
        expect(body.map((l) => [l.gOld, l.gNew, l.sign, l.text])).toEqual([
            ["10", "10", "", "ctx line"],
            ["11", "", "−", "old line"],
            ["", "11", "+", "new line"],
            ["", "12", "+", "added line"],
        ]);
        expect(v.adds).toBe(2);
        expect(v.dels).toBe(1);
    });
});

describe("parseUnifiedDiff on files with no diff text", () => {
    // git emits one sentence and no hunk for a binary file; rendering it as a context line put a
    // line number ("0") beside prose.
    const BINARY = [
        "diff --git a/blob.bin b/blob.bin",
        "index 111..222 100644",
        "Binary files a/blob.bin and b/blob.bin differ",
        "",
    ].join("\n");

    it("flags a binary file and renders none of it as a line", () => {
        const v = parseUnifiedDiff(BINARY);
        expect(v.binary).toBe(true);
        expect(v.lines).toEqual([]);
        expect(v.adds).toBe(0);
        expect(v.dels).toBe(0);
    });

    it("flags the binary-patch form too", () => {
        const v = parseUnifiedDiff("diff --git a/x b/x\nGIT binary patch\n");
        expect(v.binary).toBe(true);
        expect(v.lines).toEqual([]);
    });

    // a pure rename has no content at all, so the pane needs the old path to say anything useful
    const RENAME = [
        "diff --git a/oldname.txt b/newname.txt",
        "similarity index 100%",
        "rename from oldname.txt",
        "rename to newname.txt",
        "",
    ].join("\n");

    it("reports the old path of a pure rename and produces no lines", () => {
        const v = parseUnifiedDiff(RENAME);
        expect(v.renamedFrom).toBe("oldname.txt");
        expect(v.binary).toBe(false);
        expect(v.lines).toEqual([]);
    });

    it("an ordinary diff is neither binary nor a rename", () => {
        const v = parseUnifiedDiff(DIFF);
        expect(v.binary).toBe(false);
        expect(v.renamedFrom).toBeUndefined();
    });
});

describe("plainFileView", () => {
    it("renders a new file as an all-additions diff (green +, new gutter)", () => {
        const v = plainFileView("a\nb");
        expect(v.isDiff).toBe(true);
        expect(v.adds).toBe(2);
        expect(v.dels).toBe(0);
        expect(v.lines).toEqual([
            { gOld: "", gNew: "1", sign: "+", text: "a", kind: "add" },
            { gOld: "", gNew: "2", sign: "+", text: "b", kind: "add" },
        ]);
    });

    it("drops the phantom empty line a trailing newline leaves behind", () => {
        const v = plainFileView("a\nb\n");
        expect(v.lines.map((l) => l.text)).toEqual(["a", "b"]);
        expect(v.adds).toBe(2);
    });

    it("an empty file has no added lines", () => {
        const v = plainFileView("");
        expect(v.lines).toEqual([]);
        expect(v.adds).toBe(0);
    });
});

describe("firstChangedLine", () => {
    it("returns the new-side number of the first added line", () => {
        const view = parseUnifiedDiff(["@@ -10,3 +10,4 @@", " ctx one", "+added here", " ctx two"].join("\n"));
        expect(firstChangedLine(view)).toBe(11);
    });

    it("falls back to the first numbered line for a deletion-only hunk", () => {
        const view = parseUnifiedDiff(["@@ -10,3 +10,2 @@", " ctx one", "-gone", " ctx two"].join("\n"));
        expect(firstChangedLine(view)).toBe(10);
    });

    it("returns undefined when there is nothing to land on", () => {
        expect(firstChangedLine(parseUnifiedDiff(""))).toBeUndefined();
    });
});

describe("diffFileView", () => {
    it("parses an ordinary patch", () => {
        const v = diffFileView({ diff: DIFF });
        expect(v.lines.length).toBeGreaterThan(0);
        expect(v.tooLarge).toBeUndefined();
    });

    it("renders an untracked file as wholly added", () => {
        const v = diffFileView({ content: "one\ntwo\n", untracked: true });
        expect(v.adds).toBe(2);
        expect(v.hunkLabel).toBe("New file");
    });

    // The failure this guards: a refused patch arrives as an empty diff string, and an empty diff
    // parses into zero lines — which the pane draws as "nothing inside this file changed". The
    // reader would be told the opposite of the truth.
    it("reports a refused patch as too large, not as no changes", () => {
        const v = diffFileView({ diff: "", toolarge: true, size: 5_000_000 });
        expect(v.tooLarge).toBe(5_000_000);
        expect(v.lines).toHaveLength(0);
    });

    it("does not confuse a genuinely empty diff with a refused one", () => {
        const v = diffFileView({ diff: "" });
        expect(v.tooLarge).toBeUndefined();
        expect(v.lines).toHaveLength(0);
    });

    // toolarge without a size is still an answer; the pane just cannot name the number.
    it("survives a missing size", () => {
        expect(diffFileView({ toolarge: true }).tooLarge).toBe(0);
    });
});
