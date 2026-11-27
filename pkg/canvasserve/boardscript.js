// Appended after every board page canvasserve serves (see canvasserve.go), inside one inline script. The board runs at
// this listener's origin, which arcterm's window cannot reach into, so it talks to the frame's parent by message:
//
//   arc-canvas-height  {h}                the page's height, so arcterm draws the board as tall as its page
//   arc-canvas-proto   {screen, slots}     the screen showing and each variant slot, so arcterm draws its A/B/C chips
//   arc-canvas-slot-pick (parent -> board) {picks: {id: letter}}, so arcterm swaps a slot's variant in place
//
// A screen is an element with data-dc-screen="<name>"; the one showing is the first in document order that has a box.
// A slot is a box element with data-dc-slot="<id>" (and optionally data-dc-slot-label); its direct children with
// data-dc-variant="<letter>" are the variants, and the first shows until a pick says otherwise.
//
// A pick is applied by rewriting one <style> in <head>, never by touching the board's DOM: the screen's state is kept,
// a pick by id holds on screens mounted later, and the style sits outside what the observer below watches, so a swap
// cannot start a report loop. A page whose own Content-Security-Policy refuses inline scripts runs none of this and
// keeps the height canvas.json gives it.

/* global document, window, addEventListener, requestAnimationFrame, ResizeObserver, MutationObserver */
(function () {
    var p = window.parent;
    if (p === window) return;

    var HEIGHT_MSG = "arc-canvas-height";
    var PROTO_MSG = "arc-canvas-proto";
    var PICK_MSG = "arc-canvas-slot-pick";

    var picks = Object.create(null); // slot id -> letter, as last applied
    var lastHeight = 0;
    var lastProto = "";
    var raf = 0;
    var ro = null; // watches the page's own size and each reported slot's
    var slotEls = []; // the slot elements the report being built names
    var observed = []; // the slot elements ro watches

    // ---- picks: one <style> in <head>

    // a value placed inside a quoted attribute selector
    function q(s) {
        return (
            '"' +
            String(s).replace(/[\\"\n\r\f]/g, function (c) {
                return c === "\\" || c === '"' ? "\\" + c : "\\" + c.charCodeAt(0).toString(16) + " ";
            }) +
            '"'
        );
    }

    // The default rule hides every variant after the first, in every slot that no pick reaches. A pick reaches only a slot
    // that has its letter: a same-id slot on another screen without that letter keeps its default (first variant shown),
    // never every variant and never none. So each picked (id, letter) is excluded from the default rule and has a rule of
    // its own, both scoped by :has(> variant).
    function rules() {
        var ids = Object.keys(picks).sort();
        var reached = ids.map(function (id) {
            return "[data-dc-slot=" + q(id) + "]:has(> [data-dc-variant=" + q(picks[id]) + "])";
        });
        var hide = " {display: none !important}\n";
        var css =
            "[data-dc-slot]" +
            (reached.length ? ":not(" + reached.join(", ") + ")" : "") +
            " > [data-dc-variant] ~ [data-dc-variant]" +
            hide;
        ids.forEach(function (id, i) {
            css += reached[i] + " > [data-dc-variant]:not([data-dc-variant=" + q(picks[id]) + "])" + hide;
        });
        return css;
    }

    var style = document.createElement("style");
    style.setAttribute("data-arc-board", "");
    style.textContent = rules();
    (document.head || document.documentElement).appendChild(style);

    function applyPicks(map) {
        var next = Object.create(null);
        if (map && typeof map === "object") {
            Object.keys(map).forEach(function (id) {
                if (id && typeof map[id] === "string" && map[id]) next[id] = map[id];
            });
        }
        picks = next;
        var css = rules();
        if (style.textContent !== css) style.textContent = css;
        soon();
    }

    addEventListener("message", function (e) {
        var d = e.data;
        if (e.source !== p || !d || d.type !== PICK_MSG) return;
        applyPicks(d.picks);
    });

    // ---- what the board shows

    function hasBox(el) {
        return el.getClientRects().length > 0;
    }

    function readScreen() {
        var els = document.querySelectorAll("[data-dc-screen]");
        for (var i = 0; i < els.length; i++) {
            if (hasBox(els[i])) return els[i].getAttribute("data-dc-screen") || null;
        }
        return null;
    }

    // One entry per slot id: its first element that has a box, in page CSS px. A slot with no box (on a screen that is not
    // showing, or display: contents) has nowhere to put a chip, so it is not reported.
    function readSlots() {
        var out = [];
        var seen = Object.create(null);
        var els = document.querySelectorAll("[data-dc-slot]");
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var id = el.getAttribute("data-dc-slot");
            if (!id || seen[id] || !hasBox(el)) continue;
            var letters = [];
            for (var j = 0; j < el.children.length; j++) {
                var letter = el.children[j].getAttribute("data-dc-variant");
                if (letter && letters.indexOf(letter) < 0) letters.push(letter);
            }
            if (!letters.length) continue;
            seen[id] = true;
            var r = el.getBoundingClientRect();
            out.push({
                id: id,
                label: el.getAttribute("data-dc-slot-label") || id,
                letters: letters,
                // what the rules show: the pick where this slot has its letter, else the first variant
                picked: picks[id] && letters.indexOf(picks[id]) >= 0 ? picks[id] : letters[0],
                rect: {
                    x: Math.round(r.left + window.pageXOffset),
                    y: Math.round(r.top + window.pageYOffset),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                },
            });
            slotEls.push(el);
        }
        return out;
    }

    // A slot's box can change with no change to the body's (a menu opening inside a variant, an image arriving), so each
    // reported slot is watched too. A ResizeObserver reports once when it starts observing, so only the slots that were
    // not watched yet are added: re-observing on every report would loop.
    function watchSlots() {
        if (!ro) return;
        observed = observed.filter(function (el) {
            if (slotEls.indexOf(el) >= 0) return true;
            ro.unobserve(el);
            return false;
        });
        slotEls.forEach(function (el) {
            if (observed.indexOf(el) < 0) {
                observed.push(el);
                ro.observe(el);
            }
        });
    }

    // ---- reports: one rAF per burst of changes, each sent only when it differs from the last one sent

    function reportHeight() {
        var b = document.body;
        var h = Math.ceil(Math.max(document.documentElement.scrollHeight, b ? b.scrollHeight : 0));
        if (h === lastHeight) return;
        lastHeight = h;
        p.postMessage({ type: HEIGHT_MSG, h: h }, "*");
    }

    function reportProto() {
        slotEls = [];
        var msg = { type: PROTO_MSG, screen: readScreen(), slots: readSlots() };
        watchSlots();
        var json = JSON.stringify(msg);
        if (json === lastProto) return;
        lastProto = json;
        p.postMessage(msg, "*");
    }

    function report() {
        raf = 0;
        reportHeight();
        reportProto();
    }

    function soon() {
        if (!raf) raf = requestAnimationFrame(report);
    }

    addEventListener("load", soon);
    if (window.ResizeObserver) {
        ro = new ResizeObserver(soon);
        ro.observe(document.documentElement);
        if (document.body) ro.observe(document.body);
    }
    if (window.MutationObserver && document.body) {
        new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true });
    }
    soon();
})();
