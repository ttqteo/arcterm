import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { projectorsBuildOptions } from "../../../scripts/sync-remote-web.mjs";
import { projectFor } from "./static/projectors.js";

const COMMITTED = new URL("./static/projectors.js", import.meta.url);
const L = JSON.stringify;

describe("projectors bundle", () => {
    it("the committed bundle is current", async () => {
        const out = await build({ ...projectorsBuildOptions(), write: false });
        expect(out.outputFiles).toHaveLength(1);
        expect(out.outputFiles[0].text).toBe(readFileSync(COMMITTED, "utf8"));
    });

    it("projects claude and pi lines", () => {
        const claude = projectFor("claude", [
            L({ type: "user", message: { role: "user", content: "fix the bug" } }),
            L({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }),
        ]);
        expect(claude.map((e) => e.kind)).toEqual(["user", "message"]);
        expect(claude[0].text).toBe("fix the bug");
        expect(claude[1].text).toBe("done");

        const pi = projectFor("pi", [
            L({ type: "session", version: 3, id: "s1", cwd: "/repo" }),
            L({ type: "message", id: "u", parentId: null, message: { role: "user", content: "fix the bug" } }),
            L({
                type: "message",
                id: "a",
                parentId: "u",
                message: { role: "assistant", content: [{ type: "text", text: "done" }] },
            }),
        ]);
        expect(pi.map((e) => e.kind)).toEqual(["user", "message"]);
        expect(pi[1].text).toBe("done");
    });

    // the bundle is arcterm's projector: images as data URLs, and a queued prompt as a plain user entry (the
    // phone page reads neither images nor a queued flag)
    it("projects pasted images and queued messages for the phone page", () => {
        const png = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } };
        const out = projectFor("claude", [
            L({ type: "user", message: { content: [{ type: "text", text: "look [Image #1]" }, png] } }),
            L({
                type: "attachment",
                attachment: { type: "queued_command", commandMode: "prompt", prompt: "land them" },
            }),
        ]);
        expect(out[0].images).toEqual(["data:image/png;base64,iVBOR"]);
        expect(out[1]).toMatchObject({ kind: "user", text: "land them" });
    });

    it("an unknown runtime gives no entries", () => {
        expect(projectFor("codex", [L({ type: "user", message: { content: "hi" } })])).toEqual([]);
        expect(projectFor("", [])).toEqual([]);
    });
});
