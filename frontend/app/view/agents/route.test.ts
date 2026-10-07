import { describe, expect, it } from "vitest";
import {
    allowPickerSections,
    buildPickerSections,
    capabilityFor,
    filterPickerSections,
    modelFace,
    normalizeProfileOverrideRoute,
    normalizeRoute,
    pickerRowMeta,
    resolveEffectiveRoute,
    routePickerItems,
    scopePickerSections,
} from "./route";

const harness = (runtime: string, routecapabilities?: RouteCapabilityInfo[]): HarnessInfo =>
    ({ runtime, label: runtime.toUpperCase(), installed: true, consultcapable: true, runworkercapable: true, routecapabilities }) as HarnessInfo;

// the row the backend lists for a runtime-only pin: no model, so the CLI runs its own default
const runtimeDefault = (runtime: string): RouteCapabilityInfo => ({ runtime, resolvedmodel: "operator default" });

const cap = (
    runtime: string,
    model: string,
    extra: { provider?: string; contexthint?: string; default?: boolean } = {}
): RouteCapabilityInfo => ({
    runtime,
    model,
    resolvedmodel: model,
    provider: extra.provider ?? "",
    contexthint: extra.contexthint ?? "",
    default: extra.default ?? false,
});

const pin = (runtime: string, model?: string): RoutePin => ({ runtime, ...(model ? { model } : {}) });

describe("normalizeRoute", () => {
    it("drops a route with no runtime", () => {
        expect(normalizeRoute("", "sonnet")).toBeNull();
    });

    it("keeps the model when there is one", () => {
        expect(normalizeRoute("claude", "sonnet")).toEqual({ runtime: "claude", model: "sonnet" });
        expect(normalizeRoute("pi")).toEqual({ runtime: "pi" });
    });
});

describe("capabilityFor", () => {
    const harnesses = [harness("claude", [runtimeDefault("claude"), cap("claude", "haiku")])];

    it("matches an exact model", () => {
        expect(capabilityFor(pin("claude", "haiku"), harnesses)?.model).toBe("haiku");
    });

    it("falls back to the runtime default for a model outside the catalog", () => {
        expect(capabilityFor(pin("claude", "claude-custom-1"), harnesses)?.resolvedmodel).toBe("operator default");
    });

    it("resolves a runtime-only pin to the runtime default", () => {
        expect(capabilityFor(pin("claude"), harnesses)?.resolvedmodel).toBe("operator default");
    });

    it("finds nothing for another runtime", () => {
        expect(capabilityFor(pin("pi"), harnesses)).toBeUndefined();
    });
});

describe("route derivation", () => {
    it("resolves task, run, channel, then settings", () => {
        const input = { settings: pin("settings"), channel: pin("channel"), run: pin("run"), task: pin("task"), harnesses: [] };
        expect(resolveEffectiveRoute(input)).toMatchObject({ pin: pin("task"), source: "task" });
        expect(resolveEffectiveRoute({ ...input, task: null })).toMatchObject({ pin: pin("run"), source: "run" });
        expect(resolveEffectiveRoute({ ...input, task: null, run: null })).toMatchObject({ pin: pin("channel"), source: "channel" });
        expect(resolveEffectiveRoute({ ...input, task: null, run: null, channel: null })).toMatchObject({ pin: pin("settings"), source: "settings" });
    });

    it("treats a cleared channel or task override as inheritance", () => {
        expect(resolveEffectiveRoute({ settings: pin("settings"), channel: null, run: null, task: null, harnesses: [] })).toMatchObject({ source: "settings" });
        expect(resolveEffectiveRoute({ settings: pin("settings"), channel: pin("channel"), run: null, task: null, harnesses: [] })).toMatchObject({ source: "channel" });
    });

    it("drops a stale tier left on a persisted pin", () => {
        expect(resolveEffectiveRoute({ settings: null, task: { runtime: "pi", tier: "cheap" }, harnesses: [] })?.pin).toEqual(pin("pi"));
    });

    it("reports no capability for a runtime the catalog lacks", () => {
        const selected = resolveEffectiveRoute({ settings: pin("codex"), harnesses: [harness("pi", [runtimeDefault("pi")])] });
        expect(selected).toEqual({ pin: pin("codex"), source: "settings", capability: undefined });
    });

    it("keeps the channel override's model and drops a stale tier", () => {
        expect(normalizeProfileOverrideRoute({ route: { runtime: "claude", model: "opus", tier: "mid" } })).toEqual({ route: pin("claude", "opus") });
        expect(normalizeProfileOverrideRoute({ route: { runtime: "" } })).toEqual({ route: undefined });
    });

    it("builds picker rows exclusively from backend capabilities", () => {
        const pi = [runtimeDefault("pi"), cap("pi", "opencode/deepseek-v4-pro")];
        expect(routePickerItems([harness("pi", pi), harness("codex")])).toEqual([{ runtime: "pi", label: "PI", capabilities: pi }]);
    });
});

const flatHarnesses: HarnessInfo[] = [
    harness("pi", [
        runtimeDefault("pi"),
        cap("pi", "opencode/deepseek-v4-flash", { provider: "opencode", contexthint: "1M" }),
        cap("pi", "opencode/deepseek-v4-pro", { provider: "opencode", contexthint: "1M" }),
    ]),
    harness("claude", [cap("claude", "opus", { default: true }), cap("claude", "sonnet"), cap("claude", "haiku")]),
];

describe("model-keyed capability lookup", () => {
    it("matches a model pin exactly rather than the runtime default", () => {
        const c = capabilityFor(pin("pi", "opencode/deepseek-v4-flash"), flatHarnesses);
        expect(c?.model).toBe("opencode/deepseek-v4-flash");
        expect(c?.provider).toBe("opencode");
    });

    it("preserves the model through effective-route normalization", () => {
        const eff = resolveEffectiveRoute({ settings: pin("pi", "opencode/deepseek-v4-pro"), harnesses: flatHarnesses });
        expect(eff?.pin.model).toBe("opencode/deepseek-v4-pro");
        expect(eff?.capability?.provider).toBe("opencode");
    });
});

describe("picker sections", () => {
    it("builds model-only rows grouped by runtime, excluding the runtime default", () => {
        const sections = buildPickerSections(flatHarnesses);
        expect(sections.map((s) => s.runtime)).toEqual(["pi", "claude"]);
        expect(sections[0].rows.map((r) => r.model)).toEqual(["opencode/deepseek-v4-flash", "opencode/deepseek-v4-pro"]);
        expect(sections[0].rows.every((r) => r.label === "PI")).toBe(true);
        expect(sections[1].rows.find((r) => r.model === "opus")?.default).toBe(true);
    });

    it("omits runtimes with no model capabilities at all", () => {
        expect(buildPickerSections([harness("pi", [runtimeDefault("pi")])])).toEqual([]);
    });

    it("keeps only the allowed runtimes, and leaves an unfiltered picker unchanged", () => {
        const sections = buildPickerSections([...flatHarnesses, harness("codex", [cap("codex", "gpt-5")])]);
        expect(sections.map((s) => s.runtime)).toEqual(["pi", "claude", "codex"]);
        expect(allowPickerSections(sections, ["claude", "pi"]).map((s) => s.runtime)).toEqual(["pi", "claude"]);
        expect(allowPickerSections(sections)).toBe(sections);
        expect(allowPickerSections(sections, [])).toEqual([]);
    });

    it("filters by model and provider, case-insensitive", () => {
        const sections = buildPickerSections(flatHarnesses);
        const byModel = filterPickerSections(sections, "deepseek-v4-flash");
        expect(byModel.flatMap((s) => s.rows.map((r) => r.model))).toEqual(["opencode/deepseek-v4-flash"]);
        const byProvider = filterPickerSections(sections, "OPENCODE");
        expect(byProvider.flatMap((s) => s.rows.map((r) => r.provider))).toEqual(["opencode", "opencode"]);
        expect(filterPickerSections(sections, "").flatMap((s) => s.rows)).toHaveLength(5);
    });

    it("scopes to one harness, and ignores a scope the query has emptied", () => {
        const sections = buildPickerSections(flatHarnesses);
        expect(scopePickerSections(sections, null).map((s) => s.runtime)).toEqual(["pi", "claude"]);
        expect(scopePickerSections(sections, "claude").map((s) => s.runtime)).toEqual(["claude"]);
        const onlyPi = filterPickerSections(sections, "deepseek");
        expect(scopePickerSections(onlyPi, "claude").map((s) => s.runtime)).toEqual(["pi"]);
    });

    it("pickerRowMeta joins only the facts a row has", () => {
        const row = {
            runtime: "pi",
            model: "m",
            label: "m",
            provider: "openai-codex",
            contexthint: "128K",
            default: false,
        };
        expect(pickerRowMeta(row)).toBe("provider openai-codex · ctx 128K");
        expect(pickerRowMeta({ ...row, default: true })).toBe("provider openai-codex · ctx 128K · CLI default");
        expect(pickerRowMeta({ ...row, provider: "pi", contexthint: "" })).toBe("");
    });

    it("modelFace names the default when a route has no model", () => {
        expect(modelFace(pin("pi"))).toBe("default");
        expect(modelFace(pin("claude", "opus"))).toBe("opus");
    });
});
