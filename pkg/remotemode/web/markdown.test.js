import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { markdownBuildOptions } from "../../../scripts/sync-remote-web.mjs";
import { parseMarkdown } from "./static/markdown.js";

const COMMITTED = readFileSync(new URL("./static/markdown.js", import.meta.url), "utf8");

describe("markdown bundle", () => {
    it("the committed bundle is current", async () => {
        const out = await build({ ...markdownBuildOptions(), write: false });
        expect(out.outputFiles).toHaveLength(1);
        expect(out.outputFiles[0].text).toBe(COMMITTED);
    });

    // the browser build of decode-named-character-reference writes "&name;" into an element's innerHTML
    it("decodes character references from its own table, never through innerHTML", () => {
        expect(COMMITTED).not.toMatch(/innerHTML/);
        expect(parseMarkdown("a &amp; b &copy;").children[0].children).toMatchObject([
            { type: "text", value: "a & b ©" },
        ]);
    });
});
