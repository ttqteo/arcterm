import { describe, expect, it } from "vitest";
import { channelProjectLabel, projectLabel, registeredProjectFor } from "./projectlabel";

describe("projectLabel", () => {
    const projects = { "Krypton API": { path: "C:\\Users\\k\\IdeaProjects\\krypton" } };

    it("uses the registry name on a path match", () => {
        expect(projectLabel("C:\\Users\\k\\IdeaProjects\\krypton", projects)).toBe("Krypton API");
    });
    it("falls back to the leaf folder on a miss", () => {
        expect(projectLabel("C:\\Users\\k\\IdeaProjects\\waveterm", projects)).toBe("waveterm");
    });
    it("handles posix paths", () => {
        expect(projectLabel("/home/k/code/foo", {})).toBe("foo");
    });
    it("returns empty for empty cwd", () => {
        expect(projectLabel("", {})).toBe("");
    });
    it("names the registered project that contains the cwd", () => {
        expect(projectLabel("C:\\Users\\k\\IdeaProjects\\krypton\\pkg\\api", projects)).toBe("Krypton API");
    });
});

describe("registeredProjectFor", () => {
    const projects = {
        waveterm: { path: "C:\\Users\\k\\IdeaProjects\\waveterm" },
        "exp-arc": { path: "C:/Users/k/IdeaProjects/waveterm/.worktrees/exp-arc" },
        "MP-Frontend": { path: "C:/Users/k/IdeaProjects/MP-Frontend" },
    };

    it("maps an orchestrator worktree nested in a repo to that repo", () => {
        const taskDir = "C:/Users/k/IdeaProjects/waveterm/.waveterm-worktrees/f7dc/t-6";
        expect(registeredProjectFor(taskDir, projects)).toBe("waveterm");
    });
    it("prefers the most specific registered path", () => {
        const inWorktree = "C:\\Users\\k\\IdeaProjects\\waveterm\\.worktrees\\exp-arc\\src";
        expect(registeredProjectFor(inWorktree, projects)).toBe("exp-arc");
    });
    it("keeps hyphenated names and ignores case and separators", () => {
        expect(registeredProjectFor("c:\\users\\k\\ideaprojects\\mp-frontend", projects)).toBe("MP-Frontend");
    });
    it("does not match a sibling that only shares a name prefix", () => {
        expect(registeredProjectFor("C:/Users/k/IdeaProjects/waveterm-old", projects)).toBe("");
    });
    it("returns empty for an unregistered or empty cwd", () => {
        expect(registeredProjectFor("/tmp/scratch", projects)).toBe("");
        expect(registeredProjectFor("", projects)).toBe("");
    });
    it("keeps the most specific path whatever order the registry lists it in", () => {
        const specificFirst = {
            "exp-arc": { path: "C:/Users/k/IdeaProjects/waveterm/.worktrees/exp-arc" },
            waveterm: { path: "C:\\Users\\k\\IdeaProjects\\waveterm" },
        };
        expect(registeredProjectFor("C:/Users/k/IdeaProjects/waveterm/.worktrees/exp-arc/src", specificFirst)).toBe(
            "exp-arc"
        );
    });
    it("keeps the first of two projects whose paths normalise to the same value", () => {
        const twins = { first: { path: "/repo/x" }, second: { path: "/REPO/x/" } };
        expect(registeredProjectFor("/repo/x/sub", twins)).toBe("first");
    });
    it("lets a root path register a project that contains every cwd, but not an empty cwd", () => {
        const root = { root: { path: "/" } };
        expect(registeredProjectFor("/home/k/x", root)).toBe("root");
        expect(registeredProjectFor("", root)).toBe("");
    });
    it("skips a project with no path", () => {
        const noPaths = { a: {}, b: null, c: { path: "" } } as unknown as Record<string, { path?: string }>;
        expect(registeredProjectFor("/home/k/x", noPaths)).toBe("");
        expect(registeredProjectFor("/home/k/x", { ...noPaths, real: { path: "/home/k" } })).toBe("real");
    });
});

const ch = (oid: string, projectpath: string, name = ""): Channel => ({ oid, projectpath, name }) as Channel;
const registry = (entries: Record<string, string>): Record<string, ProjectKeywords> =>
    Object.fromEntries(Object.entries(entries).map(([name, path]) => [name, { path }]));

describe("channelProjectLabel", () => {
    it("names the registered project at the channel's path", () => {
        const projects = registry({ waveterm: "/repo/waveterm" });
        expect(channelProjectLabel(ch("c1", "/repo/waveterm", "some-old-name"), projects)).toBe("waveterm");
    });

    it("matches across separator styles, so a Windows channel path still resolves", () => {
        const projects = registry({ waveterm: "C:/Users/k/waveterm" });
        expect(channelProjectLabel(ch("c1", "C:\\Users\\k\\waveterm"), projects)).toBe("waveterm");
    });

    it("ignores a trailing slash on either side", () => {
        expect(channelProjectLabel(ch("c1", "/repo/a/"), registry({ a: "/repo/a" }))).toBe("a");
        expect(channelProjectLabel(ch("c1", "/repo/a"), registry({ a: "/repo/a/" }))).toBe("a");
    });

    it("falls back to the channel's own name when the project is not registered", () => {
        expect(channelProjectLabel(ch("c1", "/repo/gone", "legacy thread"), registry({}))).toBe("legacy thread");
    });

    it("falls back to the oid when there is no name either", () => {
        expect(channelProjectLabel(ch("c1", "", ""), registry({}))).toBe("c1");
    });

    it("does not match a channel with no path against a project whose path normalises to empty", () => {
        expect(channelProjectLabel(ch("c1", "", "legacy"), registry({ root: "/" }))).toBe("legacy");
        expect(channelProjectLabel({ oid: "c1", name: "legacy" } as Channel, registry({ root: "/" }))).toBe("legacy");
    });

    it("falls back past registered projects that do not match, and skips one with no path", () => {
        const projects = {
            other: { path: "/repo/other" },
            none: {},
            gone: null,
            a: { path: "/repo/a" },
        } as unknown as Record<string, ProjectKeywords>;
        expect(channelProjectLabel(ch("c1", "/repo/a"), projects)).toBe("a");
        expect(channelProjectLabel(ch("c1", "/repo/missing", "legacy"), projects)).toBe("legacy");
    });

    it("is empty for no channel", () => {
        expect(channelProjectLabel(null, registry({ a: "/repo/a" }))).toBe("");
        expect(channelProjectLabel(undefined, registry({ a: "/repo/a" }))).toBe("");
    });
});
