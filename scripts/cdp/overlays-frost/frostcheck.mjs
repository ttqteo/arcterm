// The check every overlays-frost-* scenario runs on a panel (docs/superpowers/plans/2026-11-14-overlays-chat-look.md):
// is it drawn on the `frost` class (frontend/tailwindsetup.css), and does the blur really have a backdrop to show?
//
//   const r = await h.ev(frostProbe('[data-context-menu]'));
//   const { ok, detail } = frostVerdict(r);
//
// frostProbe(selector) is a page expression for h.ev that evaluates to
//   { found, backdropFilter, background, panel, blockedBy }
// the element's computed backdrop-filter and background-color; `panel`, the computed value of --color-panel resolved to a
// color through a probe element (the way scenarios-agent-subagents.mjs reads --color-working); and `blockedBy`, a short
// `tag.class (why)` description of the nearest ancestor that is a backdrop root, or null. In Chromium/WebView2 an
// ancestor with opacity below 1, a filter, a backdrop-filter, a mask, a clip-path, a mix-blend-mode other than normal, or
// a will-change naming one of those is a backdrop root: a frosted element inside it blurs only what that ancestor paints,
// so its frost is nominal. (The page root is the ordinary backdrop root and is not an ancestor that blocks.)
//
// The probe does not wait: a PopoverReveal's own fade makes its motion.div a backdrop root while opacity is below 1, so a
// step waits for the panel's motion to end before it probes (or probes the motion element itself, which is never blocked
// by its own opacity).
//
// frostVerdict(r) and solidVerdict(r) turn a result into { ok, detail }; detail says what failed, or what was seen.

// the one blur the frost class draws (frontend/tailwindsetup.css @utility frost)
export const FROST_BLUR = "blur(18px)";

export function frostProbe(selector) {
    return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-panel)";
    document.body.appendChild(probe);
    const panel = getComputedStyle(probe).backgroundColor;
    probe.remove();
    if (!el) return { found: false, backdropFilter: null, background: null, panel, blockedBy: null };
    const cs = getComputedStyle(el);
    const NAMED = /(^|[\\s,])(opacity|filter|backdrop-filter|mask|mask-image|clip-path|mix-blend-mode)([\\s,]|$)/;
    const rootReason = (s) => {
        if (Number(s.opacity) < 1) return "opacity " + s.opacity;
        if (s.filter && s.filter !== "none") return "filter";
        const bf = s.backdropFilter || s.webkitBackdropFilter;
        if (bf && bf !== "none") return "backdrop-filter";
        const mask = s.maskImage || s.webkitMaskImage;
        if (mask && mask !== "none") return "mask";
        if (s.clipPath && s.clipPath !== "none") return "clip-path";
        if (s.mixBlendMode && s.mixBlendMode !== "normal") return "mix-blend-mode";
        if (s.willChange && NAMED.test(s.willChange)) return "will-change " + s.willChange;
        return null;
    };
    const describe = (n) => {
        const cls = (n.getAttribute("class") ?? "").split(/\\s+/).filter(Boolean).slice(0, 3);
        return (n.tagName.toLowerCase() + (cls.length ? "." + cls.join(".") : "")).slice(0, 80);
    };
    let blockedBy = null;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const why = rootReason(getComputedStyle(p));
        if (why) {
            blockedBy = describe(p) + " (" + why + ")";
            break;
        }
    }
    return {
        found: true,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || "none",
        background: cs.backgroundColor,
        panel,
        blockedBy,
    };
})()`;
}

// a computed color compared as text: Chromium serialises both sides of the comparison the same way, so only spacing and
// case are folded
const norm = (c) => String(c ?? "").trim().toLowerCase().replace(/\s*,\s*/g, ",").replace(/\s+/g, " ");

// no color at all: what an unset background computes to, or a --color-panel that did not resolve. rgb(0 0 0) is black, not
// clear: only an alpha of 0 is.
const isClear = (c) => {
    const s = norm(c);
    return s === "" || s === "transparent" || /^rgba\((?:[^,]*,){3}0(?:\.0+)?\)$/.test(s) || /\/ ?0(?:\.0+)?\)$/.test(s);
};

const noPanel = (r) => !r || !r.found;

// ok when the panel is found, draws blur(18px) over a background that is the panel color, and no ancestor above it is a
// backdrop root
export function frostVerdict(r) {
    if (noPanel(r)) return { ok: false, detail: "the panel was not found" };
    const why = [];
    if (norm(r.backdropFilter) !== FROST_BLUR) why.push(`backdrop-filter is ${r.backdropFilter ?? "missing"}, not ${FROST_BLUR}`);
    if (isClear(r.panel)) why.push(`--color-panel did not resolve to a color (${r.panel ?? "missing"})`);
    else if (norm(r.background) !== norm(r.panel)) why.push(`background is ${r.background ?? "missing"}, not the panel color ${r.panel}`);
    if (r.blockedBy) why.push(`${r.blockedBy} is a backdrop root above it, so the blur samples only what that paints`);
    return why.length ? { ok: false, detail: why.join("; ") } : { ok: true, detail: `${r.backdropFilter} over ${r.background}` };
}

// ok when the panel is found, has no backdrop-filter, and its background is a color that is not the panel's: the toast if
// the measurement kept it solid, the tooltips, the tray. A solid fill blurs nothing, so a backdrop root above it does not matter.
export function solidVerdict(r) {
    if (noPanel(r)) return { ok: false, detail: "the panel was not found" };
    const why = [];
    const blur = norm(r.backdropFilter);
    if (blur && blur !== "none") why.push(`backdrop-filter is ${r.backdropFilter}, a solid fill has none`);
    if (isClear(r.background)) why.push(`background is ${r.background ?? "missing"}, a solid fill needs a color`);
    else if (!isClear(r.panel) && norm(r.background) === norm(r.panel)) why.push(`background is the panel color ${r.panel}, which is the frost's fill`);
    return why.length ? { ok: false, detail: why.join("; ") } : { ok: true, detail: `no blur, background ${r.background}` };
}
