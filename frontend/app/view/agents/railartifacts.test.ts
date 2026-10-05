import { describe, expect, it } from "vitest";
import type { CanvasState } from "./canvasstore";
import { artifactsView } from "./railartifacts";

const canvas = (over: Partial<CanvasState> = {}): CanvasState => ({
    topic: "login-flow",
    dir: "/p/.superpowers/design/login-flow",
    projectDir: "/p",
    mode: "terminal",
    board: null,
    all: false,
    boards: [],
    base: null,
    status: "ready",
    lastModifiedMs: null,
    lastViewedMs: 0,
    marking: false,
    marks: [],
    reloadKey: 0,
    ...over,
});

describe("artifactsView", () => {
    it("an agent with no canvas has none", () => {
        expect(artifactsView(null)).toEqual({ topic: "", unseen: false, rows: [] });
    });
    it("lists the boards in canvas.json order, named as the canvas tabs name them", () => {
        const view = artifactsView(
            canvas({
                boards: [
                    { name: "Main.dc.html", x: 0, y: 0, w: 640, h: 480 },
                    { name: "Cards.dc.html", x: 720, y: 0, w: 640, h: 480 },
                ],
            })
        );
        expect(view.topic).toBe("login-flow");
        expect(view.rows.map((r) => [r.name, r.label])).toEqual([
            ["Main.dc.html", "Main"],
            ["Cards.dc.html", "Cards"],
        ]);
    });
    it("a board's own title is its tooltip, else its file name is", () => {
        const view = artifactsView(
            canvas({
                boards: [
                    { name: "Main.dc.html", x: 0, y: 0, w: 1, h: 1, title: "Sign-in screen" },
                    { name: "Cards.dc.html", x: 0, y: 0, w: 1, h: 1 },
                ],
            })
        );
        expect(view.rows.map((r) => r.title)).toEqual(["Sign-in screen", "Cards.dc.html"]);
    });
    it("a removed design folder lists nothing, even with the boards it last read", () => {
        const boards = [{ name: "Main.dc.html", x: 0, y: 0, w: 1, h: 1 }];
        expect(artifactsView(canvas({ boards, status: "removed" })).rows).toEqual([]);
    });
    it("a probing or unreachable server keeps the boards it last read", () => {
        const boards = [{ name: "Main.dc.html", x: 0, y: 0, w: 1, h: 1 }];
        expect(artifactsView(canvas({ boards, status: "probing" })).rows).toHaveLength(1);
        expect(artifactsView(canvas({ boards, status: "server-down" })).rows).toHaveLength(1);
    });
    it("a freshly attached canvas has the topic but no boards yet", () => {
        expect(artifactsView(canvas({ boards: [], status: "probing" }))).toEqual({
            topic: "login-flow",
            unseen: false,
            rows: [],
        });
    });
    it("flags a canvas updated since it was last looked at, only while the terminal shows", () => {
        expect(artifactsView(canvas({ lastModifiedMs: 20, lastViewedMs: 10 })).unseen).toBe(true);
        expect(artifactsView(canvas({ lastModifiedMs: 5, lastViewedMs: 10 })).unseen).toBe(false);
        expect(artifactsView(canvas({ lastModifiedMs: null })).unseen).toBe(false);
        expect(artifactsView(canvas({ mode: "canvas", lastModifiedMs: 20, lastViewedMs: 10 })).unseen).toBe(false);
    });
});
