// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure route selection and backend-capability presentation. The backend is the sole source of valid
// routes; a route is a runtime plus an optional model, and no model means the runtime's own default.

export type RouteSource = "task" | "run" | "channel" | "settings";
export type RouteCapability = NonNullable<HarnessInfo["routecapabilities"]>[number];
export type EffectiveRoute = {
    pin: RoutePin;
    source: RouteSource;
    capability?: RouteCapability;
};

export interface RoutePickerSection {
    runtime: string;
    label: string;
    capabilities: RouteCapability[];
}

export function normalizeRoute(runtime: string, model?: string): RoutePin | null {
    if (!runtime) {
        return null;
    }
    return { runtime, ...(model ? { model } : {}) };
}

export function capabilityFor(pin: RoutePin | null | undefined, harnesses: HarnessInfo[]): RouteCapability | undefined {
    if (pin == null) {
        return undefined;
    }
    const caps = harnesses.flatMap((h) => h.routecapabilities ?? []).filter((c) => c.runtime === pin.runtime);
    const model = pin.model ?? "";
    // a model the catalog does not list still launches; the CLI resolves it, so show the runtime's default row
    return caps.find((c) => (c.model ?? "") === model) ?? caps.find((c) => (c.model ?? "") === "");
}

export function resolveEffectiveRoute(input: {
    settings: RoutePin | null;
    channel?: RoutePin | null;
    run?: RoutePin | null;
    task?: RoutePin | null;
    harnesses: HarnessInfo[];
}): EffectiveRoute | null {
    const candidates: [RouteSource, RoutePin | null | undefined][] = [
        ["task", input.task],
        ["run", input.run],
        ["channel", input.channel],
        ["settings", input.settings],
    ];
    for (const [source, raw] of candidates) {
        if (raw == null) {
            continue;
        }
        const pin = normalizeRoute(raw.runtime, raw.model);
        if (pin != null) {
            return { pin, source, capability: capabilityFor(pin, input.harnesses) };
        }
    }
    return null;
}

export function normalizeProfileOverrideRoute(override: ProfileOverride): ProfileOverride {
    if (override.route == null) {
        return override;
    }
    const route = normalizeRoute(override.route.runtime, override.route.model);
    return route == null ? { ...override, route: undefined } : { ...override, route };
}

export function routePickerItems(harnesses: HarnessInfo[]): RoutePickerSection[] {
    return harnesses
        .filter((h) => (h.routecapabilities ?? []).length > 0)
        .map((h) => ({ runtime: h.runtime, label: h.label, capabilities: h.routecapabilities ?? [] }));
}

export interface PickerModelRow {
    runtime: string;
    model: string;
    provider: string;
    contexthint: string;
    default: boolean;
    label: string;
}

export interface PickerSection {
    runtime: string;
    label: string;
    rows: PickerModelRow[];
}

// model-only rows for the picker; a runtime's default row names no model, so it never becomes a row.
export function buildPickerSections(harnesses: HarnessInfo[]): PickerSection[] {
    return harnesses
        .map((h) => ({
            runtime: h.runtime,
            label: h.label,
            rows: (h.routecapabilities ?? [])
                .filter((c) => (c.model ?? "") !== "")
                .map((c) => ({
                    runtime: c.runtime,
                    model: c.model!,
                    provider: c.provider ?? "",
                    contexthint: c.contexthint ?? "",
                    default: c.default ?? false,
                    label: h.label,
                })),
        }))
        .filter((s) => s.rows.length > 0);
}

export function filterPickerSections(sections: PickerSection[], query: string): PickerSection[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return sections;
    }
    return sections
        .map((s) => ({ ...s, rows: s.rows.filter((r) => r.model.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q)) }))
        .filter((s) => s.rows.length > 0);
}

// Which harness the picker is showing. The catalog is lopsided — one harness can enumerate several
// hundred models while another has three — so a single flat list buries every other harness that many
// rows down a scroller. Scoping by harness is what keeps them reachable without a scroll marathon.
export function scopePickerSections(sections: PickerSection[], runtime: string | null): PickerSection[] {
    if (runtime == null) {
        return sections;
    }
    const scoped = sections.filter((s) => s.runtime === runtime);
    // a scope the query has already emptied is not worth honouring: it would report no matches for a
    // model that does exist, just under a different harness
    return scoped.length > 0 ? scoped : sections;
}

// A picker limited to some runtimes (the Radar audit needs one with tools). No allowlist leaves the
// sections as they are.
export function allowPickerSections(sections: PickerSection[], runtimes?: readonly string[]): PickerSection[] {
    if (runtimes == null) {
        return sections;
    }
    return sections.filter((s) => runtimes.includes(s.runtime));
}

// displayed id on the picker face / graph route line
export function modelFace(pin: RoutePin): string {
    return pin.model || "default";
}

// the line under a model: only the facts it has, so a row with no "CLI default" ends on its last fact
export function pickerRowMeta(row: PickerModelRow): string {
    return [
        row.provider && row.provider !== row.runtime ? `provider ${row.provider}` : "",
        row.contexthint ? `ctx ${row.contexthint}` : "",
        row.default ? "CLI default" : "",
    ]
        .filter(Boolean)
        .join(" · ");
}

export function pickerTitleFor(customTitle?: string): string {
    const t = customTitle?.trim();
    return t ? t : "Run route";
}
