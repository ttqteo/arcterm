import { describe, expect, it } from "vitest";
import { prettyModel } from "./modellabel";

describe("prettyModel", () => {
    it("formats claude families with major.minor version", () => {
        expect(prettyModel("claude-opus-4-8")).toBe("Opus 4.8");
        expect(prettyModel("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
        expect(prettyModel("claude-haiku-4-5")).toBe("Haiku 4.5");
        expect(prettyModel("claude-fable-5")).toBe("Fable 5");
    });
    it("reads the version from the digits after the family word only", () => {
        expect(prettyModel("v2-opus-4-8")).toBe("Opus 4.8");
    });
    it("keeps a two-digit minor", () => {
        expect(prettyModel("claude-opus-4-10")).toBe("Opus 4.10");
    });
    it("names the family alone when no version follows it", () => {
        expect(prettyModel("claude-opus")).toBe("Opus");
        expect(prettyModel("claude-sonnet-latest")).toBe("Sonnet");
    });
    it("drops an 8-digit date suffix (not a minor version)", () => {
        expect(prettyModel("claude-opus-4-20250514")).toBe("Opus 4");
    });
    it("labels openai/codex families with fixed names", () => {
        expect(prettyModel("gpt-5.5")).toBe("GPT-5.5");
        expect(prettyModel("gpt-5")).toBe("GPT-5");
        expect(prettyModel("codex-auto-review")).toBe("Codex");
    });
    it("falls back to the raw id for unknown models, and — for empty", () => {
        expect(prettyModel("some-future-model-9")).toBe("some-future-model-9");
        expect(prettyModel("")).toBe("—");
    });
});
