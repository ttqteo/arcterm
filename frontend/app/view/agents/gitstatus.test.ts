// frontend/app/view/agents/gitstatus.test.ts
import { describe, expect, it } from "vitest";
import { capFiles, numstatPath, parseGitChanges } from "./gitstatus";

const NUL = "\0";

describe("parseGitChanges", () => {
    it("joins porcelain status with numstat adds/dels", () => {
        const statusZ = ` M src/auth.ts${NUL}A  src/redis.ts${NUL}`;
        const numstat = "3\t1\tsrc/auth.ts\n9\t0\tsrc/redis.ts\n";
        const r = parseGitChanges(statusZ, numstat);
        expect(r.files).toEqual([
            { path: "src/auth.ts", status: "M", adds: 3, dels: 1 },
            { path: "src/redis.ts", status: "A", adds: 9, dels: 0 },
        ]);
        expect(r.adds).toBe(12);
        expect(r.dels).toBe(1);
    });

    it("maps untracked (??) to '?' with zero counts", () => {
        const r = parseGitChanges(`?? notes.md${NUL}`, "");
        expect(r.files).toEqual([{ path: "notes.md", status: "?", adds: 0, dels: 0 }]);
    });

    it("handles deleted files", () => {
        const r = parseGitChanges(` D old.ts${NUL}`, "0\t4\told.ts\n");
        expect(r.files[0]).toEqual({ path: "old.ts", status: "D", adds: 0, dels: 4 });
    });

    it("keys a rename by its new path and keeps the source as from", () => {
        const statusZ = `R  new.ts${NUL}old.ts${NUL}`;
        const r = parseGitChanges(statusZ, "0\t0\tnew.ts\n");
        expect(r.files).toEqual([{ path: "new.ts", status: "R", adds: 0, dels: 0, from: "old.ts" }]);
        expect(r.files[0].from).toBe("old.ts");
    });

    it("sets no from key on a change that is not a rename", () => {
        const r = parseGitChanges(` M a.ts${NUL}`, "1\t0\ta.ts\n");
        expect("from" in r.files[0]).toBe(false);
    });

    it("treats binary numstat (-/-) as zero counts and notes it", () => {
        const r = parseGitChanges(` M logo.png${NUL}`, "-\t-\tlogo.png\n");
        expect(r.files[0]).toEqual({ path: "logo.png", status: "M", adds: 0, dels: 0, note: "bin" });
    });

    // gitinfo's synthetic row for an untracked binary: "-" adds, "0" dels
    it("notes an untracked binary", () => {
        const r = parseGitChanges(`?? paper.pdf${NUL}`, "-\t0\tpaper.pdf\n");
        expect(r.files[0]).toMatchObject({ status: "?", adds: 0, note: "bin" });
    });

    // -uall still collapses an untracked directory holding its own .git; gitinfo writes no row for it
    it("notes an untracked directory as a nested repository", () => {
        const r = parseGitChanges(`?? vendor/tool/${NUL}`, "");
        expect(r.files[0]).toMatchObject({ path: "vendor/tool/", note: "repo" });
    });

    // a submodule whose own working tree changed: status says M, `diff --numstat HEAD` prints nothing
    it("notes a tracked path with no numstat row as dirty", () => {
        const r = parseGitChanges(` M reference/PoCGen${NUL} M a.ts${NUL}`, "2\t1\ta.ts\n");
        expect(r.files[0]).toMatchObject({ path: "reference/PoCGen", adds: 0, dels: 0, note: "dirty" });
        expect(r.files[1].note).toBeUndefined();
    });

    it("returns empty for a clean tree", () => {
        expect(parseGitChanges("", "")).toEqual({ files: [], adds: 0, dels: 0 });
    });

    // Real output of `git mv big.txt renamed.txt` plus a one-line edit: porcelain reports the new path,
    // numstat names both ends. Keyed by the raw numstat string the counts never matched, so a renamed
    // and edited file read as +0 −0 and its lines went missing from the totals.
    it("counts a rename that also edited content", () => {
        const r = parseGitChanges(`RM renamed.txt${NUL}big.txt${NUL}`, "1\t1\tbig.txt => renamed.txt\n");
        expect(r.files).toEqual([{ path: "renamed.txt", status: "R", adds: 1, dels: 1, from: "big.txt" }]);
        expect(r).toMatchObject({ adds: 1, dels: 1 });
    });

    it("counts a rename git wrote in its brace form", () => {
        const r = parseGitChanges(`RM sub/renamed.txt${NUL}big.txt${NUL}`, "2\t3\t{ => sub}/renamed.txt\n");
        expect(r.files[0]).toEqual({ path: "sub/renamed.txt", status: "R", adds: 2, dels: 3, from: "big.txt" });
    });

    it("leaves an ordinary path with a literal arrow-free name alone", () => {
        const r = parseGitChanges(` M a=>b.txt${NUL}`, "4\t0\ta=>b.txt\n");
        expect(r.files[0]).toEqual({ path: "a=>b.txt", status: "M", adds: 4, dels: 0 });
    });
});

describe("numstatPath", () => {
    it("resolves both rename spellings to the new path", () => {
        expect(numstatPath("big.txt => renamed.txt")).toBe("renamed.txt");
        expect(numstatPath("{ => sub}/renamed.txt")).toBe("sub/renamed.txt");
        expect(numstatPath("src/{a.txt => b.txt}")).toBe("src/b.txt");
        expect(numstatPath("{src => lib}/x.txt")).toBe("lib/x.txt");
    });

    it("passes an ordinary path through untouched", () => {
        expect(numstatPath("pkg/gitinfo/gitinfo.go")).toBe("pkg/gitinfo/gitinfo.go");
    });
});

describe("capFiles", () => {
    const mk = (path: string) => ({ path, status: "M", adds: 0, dels: 0 });

    it("returns all files and more=0 when at or under the cap", () => {
        const files = [mk("a.ts"), mk("b.ts")];
        expect(capFiles(files, 8)).toEqual({ shown: files, more: 0 });
    });

    it("truncates to the cap and reports the remainder", () => {
        const files = Array.from({ length: 11 }, (_, i) => mk(`f${i}.ts`));
        const r = capFiles(files, 8);
        expect(r.shown).toHaveLength(8);
        expect(r.shown[0].path).toBe("f0.ts");
        expect(r.more).toBe(3);
    });

    it("handles an empty list", () => {
        expect(capFiles([], 8)).toEqual({ shown: [], more: 0 });
    });
});
