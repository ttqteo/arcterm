// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The board's scene logic: parse and serialize the file, land a drawer's answer on a scene, name a selection and
// count shapes. Pure: no React, no RPC, no Excalidraw runtime.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { drawingData, drawingNumber, isFrame } from "./boarddrawings";

const FULL_OPACITY = 100;

export interface BoardScene {
    arc: BoardArcRecord;
    elements: readonly ExcalidrawElement[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
}

export class BoardFileError extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v != null && !Array.isArray(v);
}

export function parseBoardFile(text: string): BoardScene {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        throw new BoardFileError(`not valid JSON: ${(e as Error).message}`);
    }
    if (!isObject(raw)) {
        throw new BoardFileError("not a board file: the top level is not an object");
    }
    const arc = raw.arc;
    if (!isObject(arc) || typeof arc.name !== "string") {
        throw new BoardFileError("not a board file: no arc record with a name");
    }
    if (raw.elements != null && !Array.isArray(raw.elements)) {
        throw new BoardFileError("elements is not a list");
    }
    return {
        arc: arc as unknown as BoardArcRecord,
        elements: (raw.elements ?? []) as ExcalidrawElement[],
        appState: isObject(raw.appState) ? raw.appState : {},
        files: isObject(raw.files) ? raw.files : {},
    };
}

// "arc" goes first so a file damaged at its end still names itself. Deleted elements are dropped, as Excalidraw's
// own export does.
export function serializeBoard(scene: BoardScene): string {
    const file = {
        arc: scene.arc,
        type: "excalidraw",
        version: 2,
        source: "arc",
        elements: live(scene.elements),
        appState: scene.appState,
        files: scene.files,
    };
    return JSON.stringify(file, null, 2);
}

function live(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
    return elements.filter((el) => !el.isDeleted);
}

// cyrb53: a fast 53-bit string hash; this only needs to notice change, not resist attack.
function hash53(str: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// originalText, not text: resizing a container rewraps text, and resizing is not an edit.
function elementText(el: ExcalidrawElement): string {
    if (el.type !== "text") {
        return "";
    }
    return el.originalText ?? el.text ?? "";
}

// --- geometry

interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function elementBounds(el: ExcalidrawElement): Bounds {
    if ("points" in el && el.points.length > 0) {
        const xs = el.points.map((p) => p[0]);
        const ys = el.points.map((p) => p[1]);
        return {
            minX: el.x + Math.min(...xs),
            minY: el.y + Math.min(...ys),
            maxX: el.x + Math.max(...xs),
            maxY: el.y + Math.max(...ys),
        };
    }
    return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
}

function unionBounds(els: readonly ExcalidrawElement[]): Bounds | null {
    if (els.length === 0) {
        return null;
    }
    const bs = els.map(elementBounds);
    return {
        minX: Math.min(...bs.map((b) => b.minX)),
        minY: Math.min(...bs.map((b) => b.minY)),
        maxX: Math.max(...bs.map((b) => b.maxX)),
        maxY: Math.max(...bs.map((b) => b.maxY)),
    };
}

function patch(el: ExcalidrawElement, props: Record<string, unknown>): ExcalidrawElement {
    return { ...el, ...props } as ExcalidrawElement;
}

// the fields every Excalidraw element carries; the seed is derived from the id, so a test sees the same element.
function newElement(id: string, now: number, props: Record<string, unknown>): ExcalidrawElement {
    const seed = parseInt(hash53(id).slice(-8), 16);
    return {
        id,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 1,
        opacity: FULL_OPACITY,
        angle: 0,
        seed,
        version: 1,
        versionNonce: seed,
        index: null,
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
        ...props,
    } as unknown as ExcalidrawElement;
}

// --- a drawer answer, and the selection's name

export interface AnswerResult {
    scene: BoardScene;
    shapeIds: string[]; // added + changed: what Show selects and the ack sends
    textIds: string[]; // text whose words or container changed: landAnswer re-measures these
    drawingId: string; // the frame the answer landed in, new or edited
}

interface AnswerUpdate {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text?: string;
    label?: string;
    strokeColor?: string;
    backgroundColor?: string;
}

const PATCHED_PROPS = ["x", "y", "width", "height", "strokeColor", "backgroundColor"] as const;

// excalidraw's defaults for a new label: Excalifont, 20px
const LABEL_FONT_SIZE = 20;
const LABEL_FONT_FAMILY = 5;
const LABEL_LINE_HEIGHT = 1.25;

// --- the board's face. The hand-drawn fonts (Virgil 1, Excalifont 5) have no Vietnamese ơ ư đ ạ ế…: the browser borrows
// another font for each such letter, the words come out in mixed faces, and the box Excalidraw measured in the hand-drawn
// one clips their end. Nunito (6) is the one face Excalidraw ships with a Vietnamese subset; the app serves its files
// as Shantell Sans, a hand-drawn face (frontend/tauri/vite.config.ts), so the board still reads hand-drawn.

/** Excalidraw's font family number for Nunito. */
export const NUNITO = 6;
const HAND_DRAWN = new Set([1, 5]);
// Vietnamese letters outside Latin-1 (ă đ ơ ư, the dotted and hooked vowels) and the marks of a decomposed one
const LACKS_HAND_DRAWN = /[ĂăĐđĨĩŨũƠơƯưẠ-ỹ̀-̣]/;

/** Pure: whether a text has a letter the hand-drawn fonts lack. */
export function needsNunito(text: string): boolean {
    return LACKS_HAND_DRAWN.test(text);
}

/** Pure: the board's text in one face that can show it: when any live text has a letter the hand-drawn fonts lack, every
 *  live text in a hand-drawn font turns to Nunito (all of it, so a board does not read in two faces). `changed` is the
 *  ids of the text it turned, whose boxes need measuring again. A board with no such letter is returned as it is. */
export function withReadableFont(
    elements: readonly ExcalidrawElement[],
    now: number
): { elements: ExcalidrawElement[]; changed: string[] } {
    const live = elements.filter((el) => !el.isDeleted && el.type === "text");
    if (!live.some((el) => needsNunito((el as { text?: string }).text ?? ""))) {
        return { elements: [...elements], changed: [] };
    }
    const changed: string[] = [];
    const out = elements.map((el) => {
        if (el.isDeleted || el.type !== "text" || !HAND_DRAWN.has((el as { fontFamily?: number }).fontFamily ?? 0)) {
            return el;
        }
        changed.push(el.id);
        return bump(el, { fontFamily: NUNITO }, now);
    });
    return { elements: out, changed };
}

/** Pure: the ids of the live text in Nunito, which Excalidraw measured right only if the face had loaded. */
export function nunitoTextIds(elements: readonly ExcalidrawElement[]): string[] {
    return elements
        .filter((el) => !el.isDeleted && el.type === "text" && (el as { fontFamily?: number }).fontFamily === NUNITO)
        .map((el) => el.id);
}

function isBoundText(el: ExcalidrawElement): boolean {
    return el.type === "text" && el.containerId != null;
}

function bump(el: ExcalidrawElement, props: Record<string, unknown>, now: number): ExcalidrawElement {
    return patch(el, { ...props, version: el.version + 1, updated: now });
}

function parseUpdates(update: string | undefined): AnswerUpdate[] {
    if (!update) {
        return [];
    }
    const parsed: unknown = JSON.parse(update);
    if (!Array.isArray(parsed)) {
        throw new Error("the answer's update is not a list");
    }
    return parsed as AnswerUpdate[];
}

function boundTextAt(els: readonly ExcalidrawElement[], containerId: string): number {
    return els.findIndex((el) => !el.isDeleted && el.type === "text" && el.containerId === containerId);
}

// placed at the container's center; landAnswer measures it and centers it for real
function newBoundText(container: ExcalidrawElement, label: string, now: number): ExcalidrawElement {
    const b = elementBounds(container);
    const h = LABEL_FONT_SIZE * LABEL_LINE_HEIGHT;
    return newElement(`${container.id}-label-${now.toString(36)}`, now, {
        type: "text",
        x: (b.minX + b.maxX) / 2,
        y: (b.minY + b.maxY) / 2 - h / 2,
        width: 0,
        height: h,
        strokeColor: container.strokeColor,
        text: label,
        originalText: label,
        fontSize: LABEL_FONT_SIZE,
        fontFamily: LABEL_FONT_FAMILY,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: container.id,
        frameId: container.frameId,
        autoResize: true,
        lineHeight: LABEL_LINE_HEIGHT,
    });
}

function scaledPoints(el: ExcalidrawElement, width: number, height: number): [number, number][] | undefined {
    if (!("points" in el)) {
        return undefined;
    }
    const sx = el.width > 0 ? width / el.width : 1;
    const sy = el.height > 0 ? height / el.height : 1;
    return el.points.map((p) => [p[0] * sx, p[1] * sy]);
}

// patches els[i] in place (els is the caller's working copy); a moved container takes its bound text along.
function applyUpdate(els: ExcalidrawElement[], i: number, u: AnswerUpdate, now: number, textIds: string[]): void {
    const el = els[i];
    const props: Record<string, unknown> = {};
    for (const key of PATCHED_PROPS) {
        if (u[key] != null) {
            props[key] = u[key];
        }
    }
    if (u.width != null || u.height != null) {
        const points = scaledPoints(el, u.width ?? el.width, u.height ?? el.height);
        if (points != null) {
            props.points = points;
        }
    }
    if (u.text != null && el.type === "text") {
        props.text = u.text;
        props.originalText = u.text;
        textIds.push(el.id);
    }
    els[i] = bump(el, props, now);
    if (el.type === "text") {
        return;
    }
    const t = boundTextAt(els, el.id);
    if (t < 0) {
        if (u.label != null) {
            const label = newBoundText(els[i], u.label, now);
            els[i] = patch(els[i], {
                boundElements: [...(els[i].boundElements ?? []), { type: "text", id: label.id }],
            });
            // beside its container, as Excalidraw orders bound text, so it stays before the container's frame
            els.splice(i + 1, 0, label);
            textIds.push(label.id);
        }
        return;
    }
    const dx = (u.x ?? el.x) - el.x;
    const dy = (u.y ?? el.y) - el.y;
    const textProps: Record<string, unknown> = {};
    if (dx !== 0 || dy !== 0) {
        textProps.x = els[t].x + dx;
        textProps.y = els[t].y + dy;
    }
    if (u.label != null) {
        textProps.text = u.label;
        textProps.originalText = u.label;
    }
    if (Object.keys(textProps).length > 0) {
        els[t] = bump(els[t], textProps, now);
    }
    if (u.label != null || u.width != null || u.height != null) {
        textIds.push(els[t].id);
    }
}

// --- arrow routing. convertToExcalidrawElements binds a skeleton arrow to its shapes without moving it there (it
// keeps the 100px stub its x, y put down), and nothing re-routes an arrow whose shape code moved, so applyAnswer
// lays every such arrow's bound ends on their shapes' outlines.

type Point = [number, number];

const ARROW_GAP = 8;

function center(el: ExcalidrawElement): Point {
    return [el.x + el.width / 2, el.y + el.height / 2];
}

// where the ray from el's center toward `toward` leaves its outline, pushed out by the gap; null when `toward`
// is inside el, as with overlapping shapes, where no straight arrow reads right.
function edgePoint(el: ExcalidrawElement, toward: Point): Point | null {
    const [cx, cy] = center(el);
    const dx = toward[0] - cx;
    const dy = toward[1] - cy;
    const hw = el.width / 2;
    const hh = el.height / 2;
    if (hw <= 0 || hh <= 0 || (dx === 0 && dy === 0)) {
        return null;
    }
    const rx = Math.abs(dx) / hw;
    const ry = Math.abs(dy) / hh;
    // t is the fraction of (dx, dy) at which the ray meets the outline
    let t = 1 / Math.max(rx, ry);
    if (el.type === "ellipse") {
        t = 1 / Math.hypot(rx, ry);
    } else if (el.type === "diamond") {
        t = 1 / (rx + ry);
    }
    if (t >= 1) {
        return null;
    }
    const s = t + ARROW_GAP / Math.hypot(dx, dy);
    return [cx + dx * s, cy + dy * s];
}

// where Excalidraw puts an arrow's label: the middle point, or the middle of the middle segment
function labelAnchor(points: readonly Point[]): Point {
    const mid = Math.floor(points.length / 2);
    if (points.length % 2 === 1) {
        return points[mid];
    }
    const [a, b] = [points[mid - 1], points[mid]];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// routes els[i] in place, its label with it; an arrow it can't route stays as drawn
function routeArrow(els: ExcalidrawElement[], i: number, now: number): void {
    const el = els[i];
    if (el.type !== "arrow" || el.points.length < 2) {
        return;
    }
    const shapeAt = (id: string | undefined) => els.find((s) => s.id === id && !s.isDeleted);
    const from = shapeAt(el.startBinding?.elementId);
    const to = shapeAt(el.endBinding?.elementId);
    const abs: Point[] = el.points.map((p) => [el.x + p[0], el.y + p[1]]);
    const last = abs.length - 1;
    // a bent arrow aims each end at its neighbor point; a straight one runs center to center
    const aimStart = last > 1 ? abs[1] : to ? center(to) : abs[last];
    const aimEnd = last > 1 ? abs[last - 1] : from ? center(from) : abs[0];
    const start = from ? edgePoint(from, aimStart) : abs[0];
    const end = to ? edgePoint(to, aimEnd) : abs[last];
    if (start == null || end == null) {
        return;
    }
    const routed: Point[] = [start, ...abs.slice(1, last), end];
    const xs = routed.map((p) => p[0] - start[0]);
    const ys = routed.map((p) => p[1] - start[1]);
    const binding = (b: typeof el.startBinding) => (b == null ? null : { ...b, focus: 0, gap: ARROW_GAP });
    els[i] = bump(
        el,
        {
            x: start[0],
            y: start[1],
            points: xs.map((x, k) => [x, ys[k]]),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            startBinding: binding(el.startBinding),
            endBinding: binding(el.endBinding),
        },
        now
    );
    const t = boundTextAt(els, el.id);
    if (t >= 0) {
        const [mx, my] = labelAnchor(routed);
        els[t] = bump(els[t], { x: mx - els[t].width / 2, y: my - els[t].height / 2 }, now);
    }
}

// added arrows, and arrows bound to a shape the answer moved or resized
function routeArrows(els: ExcalidrawElement[], addedIds: Set<string>, movedIds: Set<string>, now: number): void {
    els.forEach((el, i) => {
        if (el.type !== "arrow" || el.isDeleted || ("elbowed" in el && el.elbowed)) {
            return;
        }
        const ends = [el.startBinding?.elementId, el.endBinding?.elementId];
        if (addedIds.has(el.id) || ends.some((id) => id != null && movedIds.has(id))) {
            routeArrow(els, i, now);
        }
    });
}

// --- drawings: each is a frame, its children before it as Excalidraw orders them

const DRAWING_GAP = 120; // between a new drawing and everything already on the board
const FRAME_PADDING = 40; // between a frame and its outermost shape
const EARLIER_TITLE = "Earlier drawings";

function padded(b: Bounds): Record<string, number> {
    return {
        x: b.minX - FRAME_PADDING,
        y: b.minY - FRAME_PADDING,
        width: b.maxX - b.minX + 2 * FRAME_PADDING,
        height: b.maxY - b.minY + 2 * FRAME_PADDING,
    };
}

function newFrame(n: number, title: string | null, around: Bounds, now: number): ExcalidrawElement {
    return newElement(crypto.randomUUID(), now, {
        type: "frame",
        ...padded(around),
        name: title,
        customData: drawingData(n),
    });
}

/** Pure: a board drawn before drawings were frames keeps its live shapes as one drawing, "Earlier drawings", number 1,
 *  the frame after its children. A board with a frame, or with nothing live, comes back as the same object, so shapes
 *  drawn loose beside drawings stay loose. */
export function wrapEarlier(scene: BoardScene, now: number): BoardScene {
    const shown = live(scene.elements);
    if (shown.length === 0 || shown.some(isFrame)) {
        return scene;
    }
    const frame = newFrame(1, EARLIER_TITLE, unionBounds(shown), now);
    const elements = scene.elements.map((el) => (el.isDeleted ? el : bump(el, { frameId: frame.id }, now)));
    return { ...scene, elements: [...elements, frame] };
}

function liveFrameId(elements: readonly ExcalidrawElement[], id: string | undefined): string | null {
    return id != null && elements.some((el) => el.id === id && isFrame(el) && !el.isDeleted) ? id : null;
}

// The answer's shapes are in the drawer's own coordinates: the drawing moves right of everything on the board, level
// with its topmost shape (an empty board: the origin), and a frame is made around it.
function landNew(
    els: readonly ExcalidrawElement[],
    before: readonly ExcalidrawElement[],
    addedIds: ReadonlySet<string>,
    title: string | undefined,
    now: number
): { elements: ExcalidrawElement[]; drawingId: string } {
    const board = unionBounds(live(before));
    const drawn = unionBounds(els.filter((el) => addedIds.has(el.id) && !el.isDeleted)) ?? {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
    };
    const left = board == null ? 0 : board.maxX + DRAWING_GAP;
    const top = board == null ? 0 : board.minY;
    const dx = left + FRAME_PADDING - drawn.minX;
    const dy = top + FRAME_PADDING - drawn.minY;
    const n = Math.max(0, ...live(before).map((el) => drawingNumber(el) ?? 0)) + 1;
    const placed = { minX: drawn.minX + dx, minY: drawn.minY + dy, maxX: drawn.maxX + dx, maxY: drawn.maxY + dy };
    const frame = newFrame(n, title || null, placed, now);
    const moved = els.map((el) =>
        addedIds.has(el.id) ? patch(el, { x: el.x + dx, y: el.y + dy, frameId: frame.id }) : el
    );
    return { elements: [...moved, frame], drawingId: frame.id };
}

// An edit uses board coordinates: its shapes join the frame, just before it, and the frame refits to its children.
function landEdit(
    els: readonly ExcalidrawElement[],
    frameId: string,
    addedIds: ReadonlySet<string>,
    now: number
): { elements: ExcalidrawElement[]; drawingId: string } {
    const joined = els.filter((el) => addedIds.has(el.id)).map((el) => patch(el, { frameId }));
    const elements = els.filter((el) => !addedIds.has(el.id));
    const at = elements.findIndex((el) => el.id === frameId);
    elements.splice(at, 0, ...joined);
    const fit = unionBounds(elements.filter((el) => el.frameId === frameId && !el.isDeleted));
    if (fit != null) {
        elements[at + joined.length] = bump(elements[at + joined.length], padded(fit), now);
    }
    return { elements, drawingId: frameId };
}

/** Re-wraps and re-measures the named text. landAnswer hands in Excalidraw's, so this module never loads it. */
export type MeasureText = (elements: readonly ExcalidrawElement[], textIds: readonly string[]) => ExcalidrawElement[];

const unmeasured: MeasureText = (elements) => [...elements];

// added (already converted) goes on top; update and remove skip ids the board no longer has, since you may have
// deleted them while the drawer answered. An answer edits the drawing it names while that frame is still on the
// board, and otherwise lands as a new drawing, on a board with drawings (wrapEarlier first, for one without). Text is
// measured before the drawing lands, so its frame fits it as measured.
export function applyAnswer(
    scene: BoardScene,
    answer: BoardAnswer,
    added: readonly ExcalidrawElement[],
    now: number,
    measureText: MeasureText = unmeasured
): AnswerResult {
    const board = wrapEarlier(scene, now);
    const editing = liveFrameId(board.elements, answer.drawingid);
    const addedIds = new Set(added.map((el) => el.id));
    const els = [...board.elements, ...added];
    const liveAt = (id: string): number => els.findIndex((el) => el.id === id && !el.isDeleted);
    const shapeIds = added.filter((el) => !isBoundText(el)).map((el) => el.id);
    const textIds: string[] = [];
    const movedIds = new Set<string>();
    for (const u of parseUpdates(answer.update)) {
        const i = liveAt(u.id);
        if (i >= 0) {
            applyUpdate(els, i, u, now, textIds);
            shapeIds.push(u.id);
            if (u.x != null || u.y != null || u.width != null || u.height != null) {
                movedIds.add(u.id);
            }
        }
    }
    for (const id of answer.remove ?? []) {
        const i = liveAt(id);
        if (i < 0) {
            continue;
        }
        const t = boundTextAt(els, id);
        els[i] = bump(els[i], { isDeleted: true }, now);
        if (t >= 0) {
            els[t] = bump(els[t], { isDeleted: true }, now);
        }
    }
    routeArrows(els, addedIds, movedIds, now);
    const changedText = [...new Set(textIds)].filter((id) => liveAt(id) >= 0);
    const measured = measureText(els, changedText);
    const landed =
        editing != null
            ? landEdit(measured, editing, addedIds, now)
            : landNew(measured, board.elements, addedIds, answer.title, now);
    return {
        scene: { ...board, elements: landed.elements },
        shapeIds: [...new Set(shapeIds)].filter((id) => liveAt(id) >= 0),
        textIds: changedText,
        drawingId: landed.drawingId,
    };
}

function oneLine(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}

// "wavesrv", "wavesrv and 2 more" (the first selected shape with words), "3 shapes" when none has words; a
// selected container's own bound text is part of it, not one more.
export function selectionLabel(elements: readonly ExcalidrawElement[], selectedIds: readonly string[]): string | null {
    const shown = live(elements);
    const byId = new Map(shown.map((el) => [el.id, el]));
    const labels = new Map<string, string>();
    for (const el of shown) {
        if (el.type === "text" && el.containerId != null) {
            labels.set(el.containerId, elementText(el));
        }
    }
    const chosen = new Set(selectedIds);
    const shapes = [...chosen]
        .map((id) => byId.get(id))
        .filter((el) => el != null && !(el.type === "text" && el.containerId != null && chosen.has(el.containerId)));
    if (shapes.length === 0) {
        return null;
    }
    const name = shapes
        .map((el) => oneLine(el.type === "text" ? elementText(el) : (labels.get(el.id) ?? "")))
        .find((s) => s !== "");
    if (name == null) {
        return plural(shapes.length, "shape");
    }
    return shapes.length === 1 ? name : `${name} and ${shapes.length - 1} more`;
}

// a labelled box is one shape; a drawing's frame is not a shape
export function shapeCount(elements: readonly ExcalidrawElement[]): number {
    return live(elements).filter((el) => !isBoundText(el) && !isFrame(el) && el.type !== "selection").length;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}
