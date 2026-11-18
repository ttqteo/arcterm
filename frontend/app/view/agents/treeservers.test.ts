import { describe, expect, it } from "vitest";
import { folderServers, rowServers, type TreeServer } from "./treeservers";

const srv = (pid: number, port: number, o: Partial<TreeServer> = {}): TreeServer => ({
    pid,
    createms: pid,
    ports: [port],
    ...o,
});

describe("rowServers", () => {
    const detached = srv(1, 4321, { owner: { kind: "agent", tabid: "tab-a" } });
    const shell = srv(2, 5173, { owner: { kind: "terminal", tabid: "tab-t" } });
    const stray = srv(3, 3000, { owner: { kind: "detached" } });

    it("holds the servers its tab owns and the ones its background tasks launched, each once, by port", () => {
        const launched = srv(4, 3001);
        expect(rowServers([detached, shell, stray, launched], "tab-a", [launched, detached]).map((s) => s.pid)).toEqual(
            [4, 1]
        );
        expect(rowServers([detached, shell, stray], "tab-t", []).map((s) => s.pid)).toEqual([2]);
    });

    it("holds none before the first reading, nor an app's server", () => {
        expect(rowServers(null, "tab-a", [])).toEqual([]);
        expect(rowServers([srv(5, 80, { owner: { kind: "app", tabid: "tab-a" } })], "tab-a", [])).toEqual([]);
    });
});

describe("folderServers", () => {
    const repo = "D:\\projects\\portfolio-redesign";
    const held = srv(1, 4321, { repo, owner: { kind: "agent", tabid: "tab-a" } });
    const stray = srv(2, 3000, { repo, owner: { kind: "detached" } });
    const closed = srv(3, 3001, { repo, owner: { kind: "agent", tabid: "tab-gone" } });
    const elsewhere = srv(4, 8080, { repo: "D:\\other", owner: { kind: "detached" } });
    const rows = new Set(["tab-a"]);

    it("open, shows the servers in its repo that no row holds; the path's case and slashes do not matter", () => {
        expect(
            folderServers([held, stray, closed, elsewhere], "d:/projects/portfolio-redesign/", true, rows).map(
                (s) => s.pid
            )
        ).toEqual([2, 3]);
    });

    it("folded, shows every server in its repo", () => {
        expect(folderServers([held, stray, elsewhere], repo, false, rows).map((s) => s.pid)).toEqual([2, 1]);
    });

    // 2026-11-18: SIEM-portal is registered at apps\portal of the SIEM-portal repo, and its :4310 runs in apps\portal\web
    it("a project registered inside its repo shows the servers that run under its folder, not the repo's others", () => {
        const repo = "D:\\Workspace\\SIEM-portal";
        const web = srv(5, 4310, {
            repo,
            cwd: "D:\\Workspace\\SIEM-portal\\apps\\portal\\web",
            owner: { kind: "detached" },
        });
        const site = srv(6, 4321, {
            repo,
            cwd: "D:\\Workspace\\SIEM-portal\\apps\\website",
            owner: { kind: "detached" },
        });
        expect(
            folderServers([web, site], "D:\\Workspace\\SIEM-portal\\apps\\portal", true, rows).map((s) => s.pid)
        ).toEqual([5]);
    });

    it("shows none for a project with no path", () => {
        expect(folderServers([held], undefined, false, rows)).toEqual([]);
    });
});
