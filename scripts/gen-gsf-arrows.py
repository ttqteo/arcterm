#!/usr/bin/env python3
"""Give the bundled Google Sans Flex arrows: the -> => <- <-> <=> ligatures Inter draws, and the arrow characters.

Google Sans Flex has no arrow glyphs at all, not even in the full font on google/fonts, so picking it as the sans face
(Settings -> Appearance -> Fonts) turned the -> and => that Inter draws as arrows back into plain characters, and every
"→" an agent writes fell to the system face. This script draws the arrows from the font's own < > - = glyphs and adds
them to public/fonts/google-sans-flex-latin.woff2:

- arrowright / arrowleft / arrowboth: the chevron of > or < as the head, and the minus sign's stroke as the shaft, a
  contour of its own that runs into the head and ends past its inner vertex; arrowdblright / arrowdblleft /
  arrowdblboth take the equal sign's two bars, each cut on a slant inside its arm; arrowup / arrowdown are the right
  arrow turned. Shaft and head overlap, flagged OVERLAP_SIMPLE as the font's own A, B, E, H… are: at the heavy end
  the minus sign's stroke is taller than the chevron's opening, so no single outline keeps one shape at every weight.
- cmap: U+2190-2194 (← ↑ → ↓ ↔) and U+21D0, U+21D2, U+21D4 (⇐ ⇒ ⇔); fontutil.ts adds them to the latin file's
  unicode-range.
- GSUB: one ligature lookup in calt (Inter's feature for the same arrows), so CSS turns it off with the rest:
  ->, <-, <->, =>, <=>. Not <= (less than or equal).
- gvar and HVAR: each glyph is built at the weight axis's three masters (1, 400, 1000) and varies between them like the
  glyphs it is built from, which vary linearly between those masters (the script checks).

Run on the file as Google Fonts serves it (it refuses a file that already has the arrows):

    git show 79df4e137:public/fonts/google-sans-flex-latin.woff2 > /tmp/gsf-latin.woff2
    python3 scripts/gen-gsf-arrows.py /tmp/gsf-latin.woff2 public/fonts/google-sans-flex-latin.woff2

Needs fonttools and brotli (pip install fonttools brotli). Google Sans Flex is SIL OFL 1.1 with no Reserved Font Name,
so a modified copy may keep its name.
"""

import sys

from fontTools.otlLib.builder import buildLigatureSubstSubtable, buildLookup
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib.instancer import instantiateVariableFont

OVERLAP_SIMPLE = 0x40

# where each master sits on the weight axis, and its gvar region
MASTERS = {"min": 1.0, "def": 400.0, "max": 1000.0}
REGIONS = {"min": (-1.0, -1.0, 0.0), "max": (0.0, 1.0, 1.0)}

# the share of the head's width the shaft shows before it reaches the head
SHAFT_SHOWN = 0.85
# where a shaft ends inside the head: this share of the way from the inner vertex to the tip
SHAFT_INTO_TIP = 0.5

CMAP = {
    0x2190: "arrowleft",
    0x2191: "arrowup",
    0x2192: "arrowright",
    0x2193: "arrowdown",
    0x2194: "arrowboth",
    0x21D0: "arrowdblleft",
    0x21D2: "arrowdblright",
    0x21D4: "arrowdblboth",
}

# component sequences -> ligature; each also matches the tabular (.tf) forms tnum may already have put in
LIGATURES = [
    (("less", "hyphen", "greater"), "arrowboth"),
    (("less", "equal", "greater"), "arrowdblboth"),
    (("hyphen", "greater"), "arrowright"),
    (("less", "hyphen"), "arrowleft"),
    (("equal", "greater"), "arrowdblright"),
]


def contours(glyf, name):
    """The glyph's outline (components decomposed) as a list of contours, each a list of ((x, y), on_curve)."""
    coords, ends, flags = glyf[name].getCoordinates(glyf)
    out, start = [], 0
    for end in ends:
        out.append([((float(coords[i][0]), float(coords[i][1])), bool(flags[i] & 1)) for i in range(start, end + 1)])
        start = end + 1
    return out


def x_at(p, q, y):
    """x where the line through p and q crosses the horizontal line at y."""
    (x0, y0), (x1, y1) = p, q
    return x0 + (x1 - x0) * (y - y0) / (y1 - y0)


class Chevron:
    """A > (or a < read mirrored, x -> -x) as the parts an arrow is cut against.

    Its distinct points: four on the back (outer and inner corner of each arm), two at the tip, two at the inner
    vertex. The back's points may sit a unit apart in x at a master, so each edge runs between its own two points.
    """

    def __init__(self, contour, sign):
        self.sign = sign  # 1 for >, -1 for < (read mirrored)
        pts = sorted({(sign * p[0], p[1]) for p, _ in contour})
        self.back = min(x for x, _ in pts)
        self.tip = max(x for x, _ in pts)
        back = sorted((p for p in pts if p[0] - self.back <= 3), key=lambda p: p[1])
        tip = sorted((p for p in pts if self.tip - p[0] <= 3), key=lambda p: p[1])
        vert = sorted((p for p in pts if p not in back and p not in tip), key=lambda p: p[1])
        if len(back) != 4 or len(tip) != 2 or len(vert) != 2:
            raise SystemExit(f"unexpected chevron points {pts}")
        self.out_lo, self.in_lo, self.in_hi, self.out_hi = back
        self.tip_lo, self.tip_hi = tip
        self.v_lo, self.v_hi = vert

    def x(self, x):
        """A mirrored x back in the glyph's own coordinates."""
        return self.sign * x

    def shaft_end(self, lo, hi):
        """Where a shaft spanning lo..hi ends inside the head, checked to stay inside it."""
        vx = (self.v_lo[0] + self.v_hi[0]) / 2
        tx = (self.tip_lo[0] + self.tip_hi[0]) / 2
        x = vx + SHAFT_INTO_TIP * (tx - vx)
        # the outer edges at x: each runs from the back's outer corner to the tip's corner on its side
        upper = self.out_hi[1] + (self.tip_hi[1] - self.out_hi[1]) * (x - self.out_hi[0]) / (self.tip_hi[0] - self.out_hi[0])
        lower = self.out_lo[1] + (self.tip_lo[1] - self.out_lo[1]) * (x - self.out_lo[0]) / (self.tip_lo[0] - self.out_lo[0])
        if not (lower <= lo and hi <= upper):
            raise SystemExit(f"a shaft {lo:.0f}..{hi:.0f} ending at {x:.0f} pokes out of the head ({lower:.0f}..{upper:.0f})")
        return self.x(x)

    def arm_mid(self, y):
        """The middle of the arm that crosses height y: where a bar at that height is cut, inside the arm."""
        if self.v_lo[1] <= y <= self.v_hi[1]:
            raise SystemExit(f"a bar edge at y={y:.0f} meets the chevron's inner vertex")
        if y > self.v_hi[1]:  # upper arm
            if y > self.out_hi[1]:
                raise SystemExit(f"a bar edge at y={y:.0f} is above the chevron")
            left = x_at(self.in_hi, self.out_hi, y) if y >= self.in_hi[1] else x_at(self.in_hi, self.v_hi, y)
            right = x_at(self.tip_lo, self.tip_hi, y) if y <= self.tip_hi[1] else x_at(self.out_hi, self.tip_hi, y)
        else:  # lower arm
            if y < self.out_lo[1]:
                raise SystemExit(f"a bar edge at y={y:.0f} is below the chevron")
            left = x_at(self.out_lo, self.in_lo, y) if y <= self.in_lo[1] else x_at(self.in_lo, self.v_lo, y)
            right = x_at(self.tip_lo, self.tip_hi, y) if y >= self.tip_lo[1] else x_at(self.out_lo, self.tip_lo, y)
        if not left < right:
            raise SystemExit(f"the arm at y={y:.0f} has no width ({left:.0f}..{right:.0f})")
        return self.x((left + right) / 2)


def on(*pts):
    return [((float(x), float(y)), True) for x, y in pts]


def moved(contour, dx):
    return [((p[0] + dx, p[1]), o) for p, o in contour]


def build_master(font):
    """Every new glyph at one master: {name: (contours, advance)}."""
    glyf, hmtx = font["glyf"], font["hmtx"]
    (gt,) = contours(glyf, "greater")
    (lt,) = contours(glyf, "less")
    (mn,) = contours(glyf, "minus")
    bars = sorted(contours(glyf, "equal"), key=lambda c: min(p[0][1] for p in c))
    if len(bars) != 2:
        raise SystemExit("the equal sign is not two bars")
    G, L = Chevron(gt, 1), Chevron(lt, -1)

    s_lo, s_hi = min(p[0][1] for p in mn), max(p[0][1] for p in mn)
    s_x0 = min(p[0][0] for p in mn)
    s_rsb = hmtx["minus"][0] - max(p[0][0] for p in mn)
    (b1_lo, b1_hi), (b2_lo, b2_hi) = [(min(p[0][1] for p in c), max(p[0][1] for p in c)) for c in bars]

    g_x0, g_x1 = G.back, G.tip
    l_x1 = L.x(L.back)  # <'s back, its right edge in its own coordinates
    g_rsb = hmtx["greater"][0] - g_x1
    shown = round(SHAFT_SHOWN * (g_x1 - g_x0))

    # -> : > after a shaft that starts where the minus sign does
    dx_r = s_x0 + shown - g_x0
    right_adv = round(g_x1 + dx_r + g_rsb)
    # <- : < where it stands, the shaft running on to the same right margin the minus sign keeps
    left_end = l_x1 + shown
    left_adv = round(left_end + s_rsb)
    # <-> : < where it stands, > after the same shown shaft
    dx_b = l_x1 + shown - g_x0
    both_adv = round(g_x1 + dx_b + g_rsb)

    def rect(x0, x1, lo, hi):
        return on((x0, lo), (x0, hi), (x1, hi), (x1, lo))  # clockwise, as TrueType fills

    def bar(lo, hi, left, right):
        """A bar from lo to hi; left / right a fixed x or a chevron (moved by dx) whose arm cuts that end."""

        def end(side, y):
            kind, val = side
            if kind == "x":
                return val
            chev, dx = val
            return chev.arm_mid(y) + dx

        return on((end(left, lo), lo), (end(left, hi), hi), (end(right, hi), hi), (end(right, lo), lo))

    out = {}
    out["arrowright"] = ([moved(gt, dx_r), rect(s_x0, G.shaft_end(s_lo, s_hi) + dx_r, s_lo, s_hi)], right_adv)
    out["arrowleft"] = ([lt, rect(L.shaft_end(s_lo, s_hi), left_end, s_lo, s_hi)], left_adv)
    out["arrowboth"] = (
        [lt, rect(L.shaft_end(s_lo, s_hi), G.shaft_end(s_lo, s_hi) + dx_b, s_lo, s_hi), moved(gt, dx_b)],
        both_adv,
    )
    out["arrowdblright"] = (
        [
            moved(gt, dx_r),
            bar(b1_lo, b1_hi, ("x", s_x0), ("arm", (G, dx_r))),
            bar(b2_lo, b2_hi, ("x", s_x0), ("arm", (G, dx_r))),
        ],
        right_adv,
    )
    out["arrowdblleft"] = (
        [
            lt,
            bar(b1_lo, b1_hi, ("arm", (L, 0)), ("x", left_end)),
            bar(b2_lo, b2_hi, ("arm", (L, 0)), ("x", left_end)),
        ],
        left_adv,
    )
    out["arrowdblboth"] = (
        [
            lt,
            bar(b1_lo, b1_hi, ("arm", (L, 0)), ("arm", (G, dx_b))),
            bar(b2_lo, b2_hi, ("arm", (L, 0)), ("arm", (G, dx_b))),
            moved(gt, dx_b),
        ],
        both_adv,
    )

    # up and down: the right arrow turned a quarter, standing on the baseline, centred in the head's height plus >'s
    # left side bearing on each side
    right_cs, _ = out["arrowright"]
    xs = [p[0] for c in right_cs for p, _ in c]
    ys = [p[1] for c in right_cs for p, _ in c]
    side = g_x0
    turned_adv = round(max(ys) - min(ys) + 2 * side)
    out["arrowup"] = (
        [[((max(ys) - y + side, x - min(xs)), o) for (x, y), o in c] for c in right_cs],  # (x, y) -> (-y, x)
        turned_adv,
    )
    out["arrowdown"] = (
        [[((y - min(ys) + side, max(xs) - x), o) for (x, y), o in c] for c in right_cs],  # (x, y) -> (y, -x)
        turned_adv,
    )
    return out


def make_glyph(glyf, cs):
    pts, ends, flags = [], [], bytearray()
    for c in cs:
        for p, o in c:
            pts.append((round(p[0]), round(p[1])))
            flags.append(1 if o else 0)
        ends.append(len(pts) - 1)
    flags[0] |= OVERLAP_SIMPLE
    g = Glyph()
    g.numberOfContours = len(cs)
    g.coordinates = GlyphCoordinates(pts)
    g.endPtsOfContours = ends
    g.flags = flags
    g.program = ttProgram.Program()
    g.program.fromBytecode(b"")
    g.recalcBounds(glyf)
    return g


def main(src, dst):
    font = TTFont(src)
    # every table read under the old glyph order before the order grows
    for tag in font.keys():
        font[tag]
    order = font.getGlyphOrder()
    if any(n in order for n in CMAP.values()):
        raise SystemExit(f"{src} already has arrow glyphs: run on the file as Google Fonts serves it")
    axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes}
    if axes != {"wght": (MASTERS["min"], MASTERS["def"], MASTERS["max"])}:
        raise SystemExit(f"unexpected axes {axes}")
    if "avar" in font:
        raise SystemExit("the font has an avar table; the linear masters below would be wrong")
    for name in ("greater", "less", "minus", "equal", "hyphen"):
        regions = sorted(tuple(t.axes["wght"]) for t in font["gvar"].variations.get(name, []))
        if regions != sorted(REGIONS.values()):
            raise SystemExit(f"{name} varies over {regions}, not only between the three masters")

    masters = {k: build_master(instantiateVariableFont(font, {"wght": v})) for k, v in MASTERS.items()}
    names = list(masters["def"])
    for k in ("min", "max"):
        for n in names:
            a, b = masters["def"][n][0], masters[k][n][0]
            if [len(c) for c in a] != [len(c) for c in b] or any(
                [o for _, o in ca] != [o for _, o in cb] for ca, cb in zip(a, b)
            ):
                raise SystemExit(f"{n}: its outline at the {k} master does not match the default one")

    glyf, hmtx, gvar = font["glyf"], font["hmtx"], font["gvar"]
    font.setGlyphOrder(order + names)
    glyf.glyphOrder = font.getGlyphOrder()
    for n in names:
        cs, adv = masters["def"][n]
        g = make_glyph(glyf, cs)
        glyf.glyphs[n] = g
        hmtx.metrics[n] = (adv, g.xMin)
        def_pts = [p for c in cs for p, _ in c]
        variations = []
        for k, region in REGIONS.items():
            k_cs, k_adv = masters[k][n]
            k_pts = [p for c in k_cs for p, _ in c]
            deltas = [(round(b[0]) - round(a[0]), round(b[1]) - round(a[1])) for a, b in zip(def_pts, k_pts)]
            # phantom points: the origin stays, the advance moves
            deltas += [(0, 0), (k_adv - adv, 0), (0, 0), (0, 0)]
            variations.append(TupleVariation({"wght": region}, deltas))
        gvar.variations[n] = variations

    # HVAR: a row of advance deltas over the two master regions for each new glyph
    hvar = font["HVAR"].table
    store = hvar.VarStore
    region_index = {}
    for i, reg in enumerate(store.VarRegionList.Region):
        (ax,) = reg.VarRegionAxis
        for k, span in REGIONS.items():
            if (ax.StartCoord, ax.PeakCoord, ax.EndCoord) == span:
                region_index[k] = i
    if set(region_index) != set(REGIONS):
        raise SystemExit("HVAR has no region for one of the masters")
    want = sorted(region_index.values())
    outer = next((i for i, vd in enumerate(store.VarData) if sorted(vd.VarRegionIndex) == want), None)
    if outer is None:
        raise SystemExit("HVAR has no delta set over just the two master regions")
    vd = store.VarData[outer]
    by_region = {v: k for k, v in region_index.items()}
    for n in names:
        adv = masters["def"][n][1]
        vd.Item.append([masters[by_region[r]][n][1] - adv for r in vd.VarRegionIndex])
        hvar.AdvWidthMap.mapping[n] = (outer << 16) | (len(vd.Item) - 1)
    vd.ItemCount = len(vd.Item)
    if hasattr(vd, "calculateNumShorts"):
        vd.calculateNumShorts()

    for t in font["cmap"].tables:
        if t.isUnicode():
            for cp, n in CMAP.items():
                t.cmap[cp] = n

    gdef = font["GDEF"].table
    if gdef.GlyphClassDef is not None:
        for n in names:
            gdef.GlyphClassDef.classDefs[n] = 1

    gsub = font["GSUB"].table
    have = set(font.getGlyphOrder())

    def forms(name):
        return [g for g in (name, f"{name}.tf") if g in have]

    mapping = {}
    for comps, lig in LIGATURES:
        seqs = [[]]
        for c in comps:
            seqs = [s + [f] for s in seqs for f in forms(c)]
        for s in seqs:
            mapping[tuple(s)] = lig
    gsub.LookupList.Lookup.append(buildLookup([buildLigatureSubstSubtable(mapping)]))
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)
    index = len(gsub.LookupList.Lookup) - 1
    calt = [fr for fr in gsub.FeatureList.FeatureRecord if fr.FeatureTag == "calt"]
    if not calt:
        raise SystemExit("the font has no calt feature to add the arrows to")
    for fr in calt:
        fr.Feature.LookupListIndex.append(index)
        fr.Feature.LookupCount = len(fr.Feature.LookupListIndex)

    font.save(dst)
    print(f"wrote {dst}: {', '.join(names)}; {len(mapping)} ligature sequences in calt")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: gen-gsf-arrows.py <google-sans-flex-latin.woff2 as served> <out.woff2>")
    main(sys.argv[1], sys.argv[2])
