// The clickable prototype the proto-chips, proto-pane and proto-rail scenarios open
// (docs/superpowers/specs/2026-11-27-prototype-feedback-design.md). writeProtoTopic writes a canvas topic folder:
//
//   Main.dc.html    the prototype, "is_interactive": true. Plain HTML (no support.js, no CDN) with two screens in one page,
//                   the board script wavesrv appends to every board is all that reads it. A button on each screen switches
//                   to the other (an inline script hides the screen that is off, so it has no box).
//                     screen "Trang chủ": slot `list` (label "danh sách") with variants A, B and C
//                     screen "Để sau":    the same slot id with variants A and B only, so a pick of C that the slot lacks
//                                         leaves its default showing
//   Later.dc.html   the screen "Để sau" as its own file, listed in canvas.json with "part_of": "Main.dc.html", as a real
//                   prototype lists each screen it mounts with <dc-import>. Not a board: no tab, no gallery entry
//   Static.dc.html  a board with no screen and no slot, listed without is_interactive
//
// canvas.json lists the screen file in `order` too, though it is not a board: what a reader of `order` must ignore.
// Every variant is drawn in its own color and layout, so a screenshot tells A from B from C.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PROTO_MAIN = "Main.dc.html";
export const PROTO_SCREEN_FILE = "Later.dc.html";
export const PROTO_STATIC = "Static.dc.html";
// the screens' names (data-dc-screen), in the design's language
export const PROTO_SCREENS = { home: "Trang chủ", later: "Để sau" };
// the slot's id and label (data-dc-slot, data-dc-slot-label) and the variants each screen has
export const PROTO_SLOT = { id: "list", label: "danh sách", letters: { home: ["A", "B", "C"], later: ["A", "B"] } };
// the buttons that switch screens: data-proto-go="later" on the first screen, data-proto-go="home" on the second
export const PROTO_GO = { later: '[data-proto-go="later"]', home: '[data-proto-go="home"]' };

// the entries of canvas.json's `boards`, in `order`
export function protoBoards() {
    return {
        [PROTO_MAIN]: { x: 0, y: 0, w: 960, h: 640, title: "Flow", is_interactive: true },
        [PROTO_SCREEN_FILE]: { x: 1040, y: 0, w: 960, h: 640, title: PROTO_SCREENS.later, part_of: PROTO_MAIN },
        [PROTO_STATIC]: { x: 0, y: 720, w: 640, h: 480, title: "Static" },
    };
}

export function protoCanvasJson() {
    const boards = protoBoards();
    return { boards, order: Object.keys(boards) };
}

const STYLE = `
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; width: 960px; height: 640px; position: relative; background: #fff; color: #111; font: 18px system-ui, sans-serif; }
    [data-dc-screen] { position: absolute; left: 0; top: 0; width: 960px; height: 640px; }
    h1 { position: absolute; left: 80px; top: 48px; margin: 0; font-size: 32px; }
    [data-dc-slot] { position: absolute; left: 80px; top: 120px; width: 400px; height: 280px; border: 1px solid #bbb; }
    [data-dc-variant] { width: 100%; height: 100%; padding: 16px; }
    [data-dc-variant] b { display: block; margin-bottom: 12px; font-size: 22px; }
    [data-dc-variant="A"] { background: #dbeafe; color: #1e3a8a; }
    [data-dc-variant="B"] { background: #dcfce7; color: #14532d; }
    [data-dc-variant="C"] { background: #ffedd5; color: #7c2d12; }
    .cards { display: flex; gap: 12px; }
    .cards i { flex: 1; height: 150px; border-radius: 12px; background: #3b82f6; }
    .rows i { display: block; height: 36px; margin-bottom: 10px; border-radius: 4px; background: #22c55e; }
    .dense { font: 13px monospace; line-height: 1.2; }
    [data-proto-go] { position: absolute; left: 80px; top: 440px; padding: 12px 20px; font: inherit; border: 2px solid #111; border-radius: 8px; background: #fff; color: #111; cursor: pointer; }
`;

// one variant, drawn differently from the others
const VARIANT_BODY = {
    A: `<div class="cards"><i></i><i></i><i></i></div>`,
    B: `<div class="rows"><i></i><i></i><i></i><i></i></div>`,
    C: `<div class="dense">${Array.from({ length: 12 }, (_, i) => `item ${i + 1}`).join(" · ")}</div>`,
};
const VARIANT_NAME = { A: "Cards", B: "Rows", C: "Compact" };

function variant(letter, screen) {
    return `<div data-dc-variant="${letter}"><b>${letter} · ${VARIANT_NAME[letter]} (${screen})</b>${VARIANT_BODY[letter]}</div>`;
}

function screenHtml(key, { hidden }) {
    const name = PROTO_SCREENS[key];
    const go = key === "home" ? { to: "later", text: `${PROTO_SCREENS.later} →` } : { to: "home", text: `← ${PROTO_SCREENS.home}` };
    const variants = PROTO_SLOT.letters[key].map((l) => variant(l, name)).join("");
    return `<section data-dc-screen="${name}"${hidden ? " hidden" : ""}>
    <h1>${name}</h1>
    <div data-dc-slot="${PROTO_SLOT.id}" data-dc-slot-label="${PROTO_SLOT.label}">${variants}</div>
    <button type="button" data-proto-go="${go.to}">${go.text}</button>
</section>`;
}

// a click on a screen's button hides every screen but the one it names; the hidden one has no box, so the board script
// reports the other as the current screen
const SWITCH_SCRIPT = `var NAMES = ${JSON.stringify(PROTO_SCREENS)};
document.addEventListener("click", function (e) {
    var go = e.target.closest("[data-proto-go]");
    if (!go) return;
    var want = NAMES[go.getAttribute("data-proto-go")];
    document.querySelectorAll("[data-dc-screen]").forEach(function (s) {
        s.hidden = s.getAttribute("data-dc-screen") !== want;
    });
});`;

// the static board holds none of the prototype's markup, so none of its rules
const STATIC_STYLE = `
    body { margin: 0; width: 640px; height: 480px; background: #fff; color: #111; font: 18px system-ui, sans-serif; }
    h1 { margin: 48px 0 0 80px; font-size: 32px; }
`;

function page(title, body, { style = STYLE, script = "" } = {}) {
    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${style}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>
`;
}

// the files, by name
export function protoFiles() {
    return {
        [PROTO_MAIN]: page("Flow", `${screenHtml("home", { hidden: false })}\n${screenHtml("later", { hidden: true })}`, {
            script: SWITCH_SCRIPT,
        }),
        // the child file is the screen alone: its button has nothing to switch to (the main board owns the switching)
        [PROTO_SCREEN_FILE]: page(PROTO_SCREENS.later, screenHtml("later", { hidden: false })),
        [PROTO_STATIC]: page("Static", "<h1>Static</h1>", { style: STATIC_STYLE }),
    };
}

// <cwd>/.superpowers/design/<topic>/project, as `wsh` and the canvas serve find a design; returns where
export function writeProtoTopic(cwd, topic) {
    const dir = join(cwd, ".superpowers", "design", topic);
    const project = join(dir, "project");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "canvas.json"), JSON.stringify(protoCanvasJson()));
    for (const [name, html] of Object.entries(protoFiles())) {
        writeFileSync(join(project, name), html);
    }
    return { dir, project };
}
