import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { FROST_BLUR, frostProbe, frostVerdict, solidVerdict } from "./frostcheck.mjs";

const PANEL = "rgba(28, 28, 28, 0.66)";
// what the page reports for a panel drawn on the frost class, with nothing above it that blocks the blur
const frosted = (over = {}) => ({ found: true, backdropFilter: "blur(18px)", background: PANEL, panel: PANEL, blockedBy: null, ...over });
// ... and for a solid panel
const solid = (over = {}) => ({ found: true, backdropFilter: "none", background: "rgb(23, 23, 23)", panel: PANEL, blockedBy: null, ...over });

describe("frostVerdict", () => {
    it("passes a panel with the 18px blur over the panel color and no backdrop root above it", () => {
        const v = frostVerdict(frosted());
        expect(v.ok).toBe(true);
        expect(v.detail).toContain("blur(18px)");
        expect(v.detail).toContain(PANEL);
    });

    it("compares colors by value, not by spacing", () => {
        expect(frostVerdict(frosted({ background: "rgba(28,28,28,0.66)" })).ok).toBe(true);
    });

    it("fails a panel that was not found", () => {
        expect(frostVerdict({ found: false, backdropFilter: null, background: null, panel: PANEL, blockedBy: null })).toEqual({
            ok: false,
            detail: "the panel was not found",
        });
        expect(frostVerdict(null).ok).toBe(false);
        expect(frostVerdict(undefined).ok).toBe(false);
    });

    it("fails a panel with no blur or another blur, and says which", () => {
        const none = frostVerdict(frosted({ backdropFilter: "none" }));
        expect(none.ok).toBe(false);
        expect(none.detail).toContain("backdrop-filter is none");
        expect(none.detail).toContain(FROST_BLUR);
        const other = frostVerdict(frosted({ backdropFilter: "blur(4px)" }));
        expect(other.ok).toBe(false);
        expect(other.detail).toContain("blur(4px)");
    });

    it("fails a panel whose background is not the panel color", () => {
        const v = frostVerdict(frosted({ background: "rgb(28, 28, 28)" }));
        expect(v.ok).toBe(false);
        expect(v.detail).toContain("background is rgb(28, 28, 28)");
        expect(v.detail).toContain(PANEL);
    });

    it("fails when --color-panel did not resolve, even though a transparent background equals it", () => {
        const v = frostVerdict(frosted({ panel: "rgba(0, 0, 0, 0)", background: "rgba(0, 0, 0, 0)" }));
        expect(v.ok).toBe(false);
        expect(v.detail).toContain("--color-panel did not resolve");
    });

    it("fails a panel with a backdrop root above it, and names it", () => {
        const v = frostVerdict(frosted({ blockedBy: "div.fixed.inset-0 (backdrop-filter)" }));
        expect(v.ok).toBe(false);
        expect(v.detail).toContain("div.fixed.inset-0 (backdrop-filter)");
        expect(v.detail).toContain("backdrop root");
    });

    it("lists every failure at once", () => {
        const v = frostVerdict(frosted({ backdropFilter: "none", background: "rgb(1, 2, 3)", blockedBy: "div (opacity 0.4)" }));
        expect(v.ok).toBe(false);
        expect(v.detail.split("; ")).toHaveLength(3);
    });
});

describe("solidVerdict", () => {
    it("passes a panel with no blur and a color that is not the panel's", () => {
        const v = solidVerdict(solid());
        expect(v.ok).toBe(true);
        expect(v.detail).toContain("rgb(23, 23, 23)");
    });

    it("takes an empty backdrop-filter as no blur", () => {
        expect(solidVerdict(solid({ backdropFilter: "" })).ok).toBe(true);
    });

    it("takes opaque black as a color: only an alpha of 0 is clear", () => {
        expect(solidVerdict(solid({ background: "rgb(0, 0, 0)" })).ok).toBe(true);
        expect(solidVerdict(solid({ background: "rgba(0, 0, 0, 0)" })).ok).toBe(false);
        expect(solidVerdict(solid({ background: "rgb(0 0 0 / 0)" })).ok).toBe(false);
    });

    it("fails a panel that blurs, and says so", () => {
        const v = solidVerdict(solid({ backdropFilter: "blur(18px)" }));
        expect(v.ok).toBe(false);
        expect(v.detail).toContain("backdrop-filter is blur(18px)");
    });

    it("fails a panel drawn in the panel color", () => {
        const v = solidVerdict(solid({ background: PANEL }));
        expect(v.ok).toBe(false);
        expect(v.detail).toContain("the frost's fill");
    });

    it("fails a transparent panel", () => {
        const v = solidVerdict(solid({ background: "rgba(0, 0, 0, 0)" }));
        expect(v.ok).toBe(false);
        expect(v.detail).toContain("needs a color");
    });

    it("does not care about a backdrop root above a fill that blurs nothing", () => {
        expect(solidVerdict(solid({ blockedBy: "div (opacity 0.5)" })).ok).toBe(true);
    });

    it("fails a panel that was not found", () => {
        expect(solidVerdict({ found: false }).ok).toBe(false);
        expect(solidVerdict(null).ok).toBe(false);
    });
});

// a tiny DOM, enough for the probe: nodes with a parent, a tag, a class attribute and computed styles
function node(tag, cls, cs, parent = null) {
    const n = { tagName: tag.toUpperCase(), parentElement: parent, cs, getAttribute: (a) => (a === "class" ? cls : null) };
    return n;
}
const BASE = { opacity: "1", filter: "none", backdropFilter: "none", maskImage: "none", clipPath: "none", mixBlendMode: "normal", willChange: "auto" };
const PANEL_CS = { ...BASE, backdropFilter: "blur(18px)", backgroundColor: PANEL };

// runs the probe for `selector` in a page whose tree is html > body > chain... > panel, with --color-panel computing to PANEL
function runProbe(selector, chain, panelNode) {
    const html = node("html", "", BASE);
    const body = node("body", "", BASE, html);
    let parent = body;
    for (const n of chain) {
        n.parentElement = parent;
        parent = n;
    }
    if (panelNode) panelNode.parentElement = parent;
    const created = [];
    const doc = {
        documentElement: html,
        body: { appendChild: (c) => created.push(c) },
        createElement: () => {
            const c = { style: {}, remove() {}, get cs() { return { backgroundColor: this.style.backgroundColor === "var(--color-panel)" ? PANEL : "" }; } };
            return c;
        },
        querySelector: (s) => (s === selector ? (panelNode ?? null) : null),
    };
    const out = runInNewContext(frostProbe(selector), { document: doc, getComputedStyle: (n) => n.cs });
    return JSON.parse(JSON.stringify(out));
}

describe("frostProbe", () => {
    it("is a page expression that parses, whatever the selector holds", () => {
        for (const sel of ["[data-menu]", `div[title="a'b"]`, "a\\b`${x}"]) {
            expect(() => new Script(frostProbe(sel))).not.toThrow();
        }
    });

    it("reports a missing element with the panel color", () => {
        expect(runProbe("#nope", [], null)).toEqual({ found: false, backdropFilter: null, background: null, panel: PANEL, blockedBy: null });
    });

    it("reports a frosted panel with nothing above it that blocks", () => {
        const panel = node("div", "frost rounded-lg", PANEL_CS);
        const r = runProbe("#p", [node("div", "fixed inset-0", BASE)], panel);
        expect(r).toEqual({ found: true, backdropFilter: "blur(18px)", background: PANEL, panel: PANEL, blockedBy: null });
        expect(frostVerdict(r).ok).toBe(true);
    });

    it("names the nearest ancestor that is a backdrop root, and why", () => {
        const cases = [
            [{ opacity: "0.4" }, "opacity 0.4"],
            [{ filter: "blur(2px)" }, "filter"],
            [{ backdropFilter: "blur(4px)" }, "backdrop-filter"],
            [{ maskImage: "linear-gradient(black, transparent)" }, "mask"],
            [{ clipPath: "inset(0px round 8px)" }, "clip-path"],
            [{ mixBlendMode: "multiply" }, "mix-blend-mode"],
            [{ willChange: "opacity" }, "will-change opacity"],
            [{ willChange: "transform, opacity" }, "will-change transform, opacity"],
        ];
        for (const [style, why] of cases) {
            const outer = node("div", "outer", BASE);
            const root = node("div", "scrim bg-black/60 extra dropped", { ...BASE, ...style });
            const panel = node("div", "frost", PANEL_CS);
            const r = runProbe("#p", [outer, root, node("section", "", BASE)], panel);
            expect(r.blockedBy).toBe(`div.scrim.bg-black/60.extra (${why})`);
            expect(frostVerdict(r).ok).toBe(false);
        }
    });

    it("takes the nearest of two backdrop roots", () => {
        const far = node("div", "far", { ...BASE, filter: "blur(1px)" });
        const near = node("div", "near", { ...BASE, opacity: "0.5" });
        const r = runProbe("#p", [far, near], node("div", "frost", PANEL_CS));
        expect(r.blockedBy).toBe("div.near (opacity 0.5)");
    });

    it("does not count a will-change that names a property which makes no backdrop root", () => {
        const r = runProbe("#p", [node("div", "m", { ...BASE, willChange: "transform" })], node("div", "frost", PANEL_CS));
        expect(r.blockedBy).toBe(null);
    });

    it("does not count the panel's own opacity, or the page root", () => {
        const html = node("html", "", { ...BASE, filter: "blur(1px)" });
        const panel = node("div", "frost", { ...PANEL_CS, opacity: "0.5" });
        const body = node("body", "", BASE, html);
        panel.parentElement = body;
        const doc = {
            documentElement: html,
            body: { appendChild() {} },
            createElement: () => ({ style: {}, remove() {}, get cs() { return { backgroundColor: PANEL }; } }),
            querySelector: () => panel,
        };
        const out = runInNewContext(frostProbe("#p"), { document: doc, getComputedStyle: (n) => n.cs });
        expect(out.blockedBy).toBe(null);
    });

    it("reads the prefixed blur where only that exists, and reports none when there is none", () => {
        const legacy = node("div", "frost", { ...BASE, backdropFilter: "", webkitBackdropFilter: "blur(18px)", backgroundColor: PANEL });
        expect(runProbe("#p", [], legacy).backdropFilter).toBe("blur(18px)");
        const plain = node("div", "p", { ...BASE, backdropFilter: "", backgroundColor: "rgb(23, 23, 23)" });
        expect(runProbe("#p", [], plain).backdropFilter).toBe("none");
    });
});
