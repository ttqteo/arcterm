import { describe, expect, it } from "vitest";
import { FILES_HEADER } from "./composerattachments";
import { pinnedLabel } from "./pinnedlabel";

describe("pinnedLabel", () => {
    it("is the message's text, without the blocks of what it carried", () => {
        expect(pinnedLabel("fix the bug")).toBe("fix the bug");
        expect(pinnedLabel("look\n\nAttached images:\n- /a/shot.png")).toBe("look");
        expect(pinnedLabel(`look\n\n${FILES_HEADER}\n- /a/err.log`)).toBe("look");
    });

    // a message of only pictures or files is no pin: the bar keeps your last message that says something, not "(picture)"
    it("is null for a message that carries only pictures or files", () => {
        expect(pinnedLabel("Attached images:\n- /a/shot.png")).toBeNull();
        expect(pinnedLabel(`${FILES_HEADER}\n- /a/err.log`)).toBeNull();
        expect(pinnedLabel("")).toBeNull();
        expect(pinnedLabel("  \n ")).toBeNull();
    });
});
