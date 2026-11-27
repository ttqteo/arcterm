// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package canvasserve

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/htmlserve"
)

const boardBody = "<!doctype html><p>board</p>"

// a project with one topic's Main board, plus a file beside the design folder that must stay unreachable
func designDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	design := filepath.Join(root, ".superpowers", "design")
	project := filepath.Join(design, "topic", "project")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "Main.dc.html"), []byte(boardBody), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(design, "topic", "canvas.json"), []byte(canvasJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"secret.txt", "secret.html"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("secret"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return design
}

const canvasJSON = `{"boards":{}}`

func get(t *testing.T, method, path string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec.Result()
}

func TestRegisterRefusesAnythingButADesignFolder(t *testing.T) {
	design := designDir(t)
	for name, dir := range map[string]string{
		"relative":       filepath.Join(".superpowers", "design"),
		"project root":   filepath.Dir(filepath.Dir(design)),
		"a topic folder": filepath.Join(design, "topic"),
		"missing":        filepath.Join(t.TempDir(), ".superpowers", "design"),
		"climbs out":     filepath.Join(design, "..", ".."),
	} {
		if _, err := Register(dir); err == nil {
			t.Errorf("%s: Register(%q) succeeded", name, dir)
		}
	}
}

func TestRegisterIsStablePerFolder(t *testing.T) {
	design := designDir(t)
	first, err := Register(design)
	if err != nil {
		t.Fatal(err)
	}
	again, err := Register(design + string(filepath.Separator))
	if err != nil {
		t.Fatal(err)
	}
	if first != again {
		t.Errorf("the same folder registered as %q then %q", first, again)
	}
	other, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	if other == first {
		t.Errorf("two folders share the path %q", first)
	}
}

func TestHandlerServesARegisteredFolder(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	res := get(t, http.MethodGet, base+"/topic/project/Main.dc.html")
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(body) != boardBody+boardScript {
		t.Fatalf("GET board: status %d body %q", res.StatusCode, body)
	}
	if res.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("Cache-Control %q, want no-cache", res.Header.Get("Cache-Control"))
	}
	if res.Header.Get("Last-Modified") == "" {
		t.Error("no Last-Modified header; the canvas poller reloads boards by it")
	}
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
		t.Errorf("Content-Type %q, want text/html", res.Header.Get("Content-Type"))
	}
	if head := get(t, http.MethodHead, base+"/topic/project/Main.dc.html"); head.StatusCode != http.StatusOK {
		t.Errorf("HEAD board: status %d", head.StatusCode)
	}
	if got := res.Header.Get("Content-Security-Policy"); got != htmlserve.CSP {
		t.Errorf("board Content-Security-Policy %q, want htmlserve.CSP", got)
	}
}

func TestHandlerAddsTheBoardScriptToPagesOnly(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	res := get(t, http.MethodGet, base+"/topic/canvas.json")
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(body) != canvasJSON {
		t.Errorf("GET canvas.json: status %d body %q", res.StatusCode, body)
	}
	// a range of a page still reads the file and the script after it as one
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, base+"/topic/project/Main.dc.html", nil)
	req.Header.Set("Range", "bytes=0-14")
	Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != boardBody[:15] {
		t.Errorf("GET a range: status %d body %q", rec.Code, rec.Body.String())
	}
}

func TestHandlerRefusesWhatWasNotRegistered(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	for name, tc := range map[string]struct {
		method, path string
		want         int
	}{
		"unknown token": {http.MethodGet, PathPrefix + "0123456789abcdef0123456789abcdef/topic/project/Main.dc.html", http.StatusNotFound},
		"no token":      {http.MethodGet, PathPrefix, http.StatusNotFound},
		"missing file":  {http.MethodGet, base + "/topic/project/Nope.dc.html", http.StatusNotFound},
		"write":         {http.MethodPost, base + "/topic/project/Main.dc.html", http.StatusMethodNotAllowed},
	} {
		if res := get(t, tc.method, tc.path); res.StatusCode != tc.want {
			t.Errorf("%s: status %d, want %d", name, res.StatusCode, tc.want)
		}
	}
}

func TestHandlerStaysInsideTheFolder(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		base + "/../../secret.txt",
		base + "/topic/../../../secret.txt",
		base + "/../../secret.html",
		base + "/topic/../../../secret.html",
	} {
		res := get(t, http.MethodGet, path)
		body, _ := io.ReadAll(res.Body)
		if res.StatusCode == http.StatusOK || strings.Contains(string(body), "secret") {
			t.Errorf("GET %s: status %d body %q", path, res.StatusCode, body)
		}
	}
}

func TestBoardScriptEndsEveryServedBoard(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	res := get(t, http.MethodGet, base+"/topic/project/Main.dc.html")
	body, _ := io.ReadAll(res.Body)
	if !strings.HasSuffix(string(body), boardScript) {
		t.Fatalf("a served board does not end with the board script: %q", body)
	}
	if n := strings.Count(string(body), "<script>"); n != 1 {
		t.Errorf("a served board holds %d <script> blocks of arcterm's, want one", n)
	}
	for _, want := range []string{
		"arc-canvas-height",
		"arc-canvas-proto",
		"arc-canvas-slot-pick",
		// a pick reaches only a slot that has the letter: a same-id slot without it keeps its default
		":has(> [data-dc-variant=",
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("a served board's script lacks %q", want)
		}
	}
}

func TestBoardScriptCannotEndItsOwnTag(t *testing.T) {
	low := strings.ToLower(boardScriptSource)
	for _, bad := range []string{"</script", "<!--"} {
		if strings.Contains(low, bad) {
			t.Errorf("boardscript.js holds %q, which the HTML parser reads inside an inline script", bad)
		}
	}
	if !strings.HasPrefix(boardScript, "<script>") || !strings.HasSuffix(boardScript, "</script>\n") {
		t.Errorf("boardScript is not one <script> block: %.40q … %.40q", boardScript, boardScript[len(boardScript)-40:])
	}
}

// boardScriptHarness runs boardscript.js in a node vm against a stub page: fake screens and slots with the few DOM
// calls the script makes, a parent window that records what is posted to it, and observers that fire the way the
// browser's do (a ResizeObserver reports once when it starts observing, so a script that re-observes on every report
// loops). It prints what was posted and the <style> text after the load and after each step.
const boardScriptHarness = `
const vm = require("vm");
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const posted = [], rafQueue = [], roQueue = [], headKids = [], moCalls = [], handlers = {};
let moCb = null, current = -1;

function fakeEl(attrs, kids, box, rect) {
  return {
    children: kids,
    getAttribute: function (n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null; },
    getClientRects: function () { return box() ? [{}] : []; },
    getBoundingClientRect: function () { return { left: rect.x, top: rect.y, width: rect.w, height: rect.h }; },
  };
}
const screens = (input.screens || []).map(function (s) {
  return fakeEl({ "data-dc-screen": s.name }, [], function () { return s.box; }, { x: 0, y: 0, w: 0, h: 0 });
});
const slots = (input.slots || []).map(function (s) {
  const attrs = { "data-dc-slot": s.id };
  if (s.label) attrs["data-dc-slot-label"] = s.label;
  const kids = s.variants.map(function (l) {
    return fakeEl(l ? { "data-dc-variant": l } : {}, [], function () { return true; }, s.rect);
  });
  return fakeEl(attrs, kids, function () { return s.box; }, s.rect);
});

const parent = { postMessage: function (m) { posted.push({ step: current, msg: JSON.parse(JSON.stringify(m)) }); } };
const document = {
  documentElement: { scrollHeight: input.height || 0 },
  body: { scrollHeight: 0 },
  head: { appendChild: function (n) { headKids.push(n); } },
  createElement: function (tag) {
    return { tag: tag, attrs: {}, textContent: "", setAttribute: function (k, v) { this.attrs[k] = v; } };
  },
  querySelectorAll: function (sel) {
    return sel === "[data-dc-screen]" ? screens : sel === "[data-dc-slot]" ? slots : [];
  },
};
const sandbox = {
  document: document,
  pageXOffset: (input.scroll || [0, 0])[0],
  pageYOffset: (input.scroll || [0, 0])[1],
  addEventListener: function (t, f) { (handlers[t] = handlers[t] || []).push(f); },
  requestAnimationFrame: function (f) { rafQueue.push(f); return rafQueue.length; },
  ResizeObserver: class {
    constructor(cb) { this.cb = cb; }
    observe() { roQueue.push(this.cb); }
    unobserve() {}
    disconnect() {}
  },
  MutationObserver: class {
    constructor(cb) { moCb = cb; }
    observe(target, opts) {
      moCalls.push({ target: target === document.body ? "body" : "other", opts: JSON.parse(JSON.stringify(opts)) });
    }
  },
};
sandbox.window = sandbox;
sandbox.parent = input.topLevel ? sandbox : parent;

function flush() {
  for (let round = 0; ; round++) {
    if (round > 20) throw new Error("the script is still scheduling reports after 20 rounds: a write loop");
    const raf = rafQueue.splice(0), ro = roQueue.splice(0);
    if (!raf.length && !ro.length) return;
    ro.forEach(function (f) { f([]); });
    raf.forEach(function (f) { f(); });
  }
}
function styleText() {
  const styles = headKids.filter(function (k) { return k.tag === "style"; });
  return styles.length ? styles[styles.length - 1].textContent : "";
}

vm.runInContext(input.script, vm.createContext(sandbox));
flush();
const css = [styleText()];
(input.steps || []).forEach(function (step, i) {
  current = i;
  Object.keys(step.boxes || {}).forEach(function (k) { input.slots[Number(k)].box = step.boxes[k]; });
  if (step.boxes) moCb([]);
  if (step.msg) {
    (handlers.message || []).forEach(function (f) { f({ source: step.from === "other" ? {} : parent, data: step.msg }); });
  }
  flush();
  css.push(styleText());
});
process.stdout.write(JSON.stringify({
  posted: posted,
  css: css,
  styles: headKids.filter(function (k) { return k.tag === "style"; }).length,
  headKids: headKids.length,
  mo: moCalls,
}));
`

type bsRect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type bsSlot struct {
	ID       string   `json:"id"`
	Label    string   `json:"label,omitempty"`
	Variants []string `json:"variants"` // "" is a child with no data-dc-variant
	Box      bool     `json:"box"`
	Rect     bsRect   `json:"rect"`
}

type bsScreen struct {
	Name string `json:"name"`
	Box  bool   `json:"box"`
}

type bsStep struct {
	Msg   map[string]any  `json:"msg,omitempty"`
	From  string          `json:"from,omitempty"`  // "other" posts from a window that is not the parent
	Boxes map[string]bool `json:"boxes,omitempty"` // slot index -> whether it has a box, before the message
}

type bsIn struct {
	Script   string     `json:"script"`
	TopLevel bool       `json:"topLevel,omitempty"`
	Height   int        `json:"height"`
	Scroll   [2]float64 `json:"scroll"`
	Screens  []bsScreen `json:"screens"`
	Slots    []bsSlot   `json:"slots"`
	Steps    []bsStep   `json:"steps"`
}

type bsOut struct {
	Posted []struct {
		Step int             `json:"step"`
		Msg  json.RawMessage `json:"msg"`
	} `json:"posted"`
	CSS      []string `json:"css"` // [0] after the load, [i+1] after step i
	Styles   int      `json:"styles"`
	HeadKids int      `json:"headKids"`
	MO       []struct {
		Target string          `json:"target"`
		Opts   map[string]bool `json:"opts"`
	} `json:"mo"`
}

type bsReported struct {
	Type   string  `json:"type"`
	Screen *string `json:"screen"`
	Slots  []struct {
		ID      string   `json:"id"`
		Label   string   `json:"label"`
		Letters []string `json:"letters"`
		Picked  string   `json:"picked"`
		Rect    bsRect   `json:"rect"`
	} `json:"slots"`
	H int `json:"h"`
}

func runBoardScript(t *testing.T, in bsIn) bsOut {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		// not a skip: the repo's own test runner (scripts/verify.mjs) is node, and a skipped check would pass unseen
		t.Fatalf("node is not on PATH: the board script's report and rules are checked by running it there: %v", err)
	}
	harness := filepath.Join(t.TempDir(), "harness.js")
	if err := os.WriteFile(harness, []byte(boardScriptHarness), 0o644); err != nil {
		t.Fatal(err)
	}
	in.Script = boardScriptSource
	if in.Steps == nil {
		in.Steps = []bsStep{}
	}
	stdin, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, node, harness)
	var stdout, stderr bytes.Buffer
	cmd.Stdin, cmd.Stdout, cmd.Stderr = bytes.NewReader(stdin), &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("running the board script: %v\n%s", err, stderr.String())
	}
	var out bsOut
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		t.Fatalf("reading the harness output %q: %v", stdout.String(), err)
	}
	return out
}

// what the board posted of one type while one step ran (step -1 is the load)
func (o bsOut) posted(t *testing.T, step int, typ string) []bsReported {
	t.Helper()
	var msgs []bsReported
	for _, p := range o.Posted {
		var m bsReported
		if err := json.Unmarshal(p.Msg, &m); err != nil {
			t.Fatalf("reading a posted message %s: %v", p.Msg, err)
		}
		if p.Step == step && m.Type == typ {
			msgs = append(msgs, m)
		}
	}
	return msgs
}

const (
	defaultRule = `[data-dc-slot] > [data-dc-variant] ~ [data-dc-variant] {display: none !important}`
	pickC       = `[data-dc-slot="list"]:has(> [data-dc-variant="C"]) > [data-dc-variant]:not([data-dc-variant="C"]) {display: none !important}`
	hasC        = `[data-dc-slot="list"]:has(> [data-dc-variant="C"])`
)

func pickMsg(picks map[string]any) map[string]any {
	return map[string]any{"type": "arc-canvas-slot-pick", "picks": picks}
}

func TestBoardScriptReportsTheScreenAndItsSlots(t *testing.T) {
	out := runBoardScript(t, bsIn{
		Height: 640,
		Scroll: [2]float64{5, 7},
		Screens: []bsScreen{
			{"Home", false}, // not showing: no box
			{"Để sau", true},
			{"Third", true}, // the first one with a box wins
		},
		Slots: []bsSlot{
			{ID: "list", Label: "danh sách", Variants: []string{"A", "B", "C"}, Box: true, Rect: bsRect{10.4, 20, 300, 80.6}},
			{ID: "list", Variants: []string{"A", "B"}, Box: false}, // the same slot on a screen that is not showing
			{ID: "menu", Variants: []string{"", "A", "B"}, Box: true, Rect: bsRect{0, 0, 50, 50}},
			{ID: "ghost", Variants: []string{"A", "B"}, Box: false}, // display: contents or hidden: no rect for a chip
			{ID: "bare", Variants: []string{""}, Box: true},         // no variants: nothing to swap
		},
		// a body change that moves nothing, so nothing new is reported
		Steps: []bsStep{{Boxes: map[string]bool{"3": false}}},
	})
	heights := out.posted(t, -1, "arc-canvas-height")
	if len(heights) != 1 || heights[0].H != 640 {
		t.Errorf("height reports on load: %+v, want one of 640", heights)
	}
	protos := out.posted(t, -1, "arc-canvas-proto")
	if len(protos) != 1 {
		t.Fatalf("proto reports on load: %d, want 1", len(protos))
	}
	m := protos[0]
	if m.Screen == nil || *m.Screen != "Để sau" {
		t.Errorf("screen %v, want Để sau", m.Screen)
	}
	if len(m.Slots) != 2 {
		t.Fatalf("slots %+v, want list and menu", m.Slots)
	}
	list, menu := m.Slots[0], m.Slots[1]
	if list.ID != "list" || list.Label != "danh sách" || strings.Join(list.Letters, "") != "ABC" || list.Picked != "A" ||
		list.Rect != (bsRect{15, 27, 300, 81}) { // page px: the box plus the scroll, rounded
		t.Errorf("list slot %+v", list)
	}
	if menu.ID != "menu" || menu.Label != "menu" || strings.Join(menu.Letters, "") != "AB" || menu.Picked != "A" {
		t.Errorf("menu slot %+v (a label defaults to the id; a child with no data-dc-variant is no variant)", menu)
	}
	if n := len(out.posted(t, 0, "arc-canvas-proto")) + len(out.posted(t, 0, "arc-canvas-height")); n != 0 {
		t.Errorf("a change that moved nothing posted %d reports, want none (deduped by JSON)", n)
	}
}

func TestBoardScriptReportsAStaticBoardWithNoSlots(t *testing.T) {
	out := runBoardScript(t, bsIn{})
	if len(out.Posted) != 1 || string(out.Posted[0].Msg) != `{"type":"arc-canvas-proto","screen":null,"slots":[]}` {
		t.Errorf("a board with no screen and no slot posted %+v, want one empty proto report", out.Posted)
	}
}

func TestBoardScriptDoesNothingOutsideAFrame(t *testing.T) {
	out := runBoardScript(t, bsIn{
		TopLevel: true,
		Height:   300,
		Slots:    []bsSlot{{ID: "list", Variants: []string{"A", "B"}, Box: true}},
	})
	if len(out.Posted) != 0 || out.HeadKids != 0 {
		t.Errorf("a page that is not in a frame posted %d messages and added %d head nodes", len(out.Posted), out.HeadKids)
	}
}

func TestBoardScriptWatchesTheBodySubtreeAndItsAttributes(t *testing.T) {
	out := runBoardScript(t, bsIn{})
	found := false
	for _, mo := range out.MO {
		if mo.Target == "body" && mo.Opts["childList"] && mo.Opts["subtree"] && mo.Opts["attributes"] {
			found = true
		}
	}
	if !found {
		t.Errorf("no MutationObserver on the body subtree with attributes: %+v", out.MO)
	}
}

func TestBoardScriptShowsTheFirstVariantBeforeAnyPick(t *testing.T) {
	out := runBoardScript(t, bsIn{Slots: []bsSlot{{ID: "list", Variants: []string{"A", "B", "C"}, Box: true}}})
	if len(out.CSS) != 1 || strings.TrimSpace(out.CSS[0]) != defaultRule {
		t.Errorf("style before any pick: %q, want only %q", out.CSS, defaultRule)
	}
	if out.Styles != 1 {
		t.Errorf("%d <style> elements in head, want 1", out.Styles)
	}
}

// the lead's plan-review N4: a slot whose id is picked but which lacks the picked letter must still show only its
// first variant, not every variant and not none
func TestBoardScriptPickRulesNeedTheLetterInTheSlot(t *testing.T) {
	out := runBoardScript(t, bsIn{
		Slots: []bsSlot{
			{ID: "list", Variants: []string{"A", "B", "C"}, Box: true, Rect: bsRect{0, 0, 100, 40}},
			{ID: "list", Variants: []string{"A", "B"}, Box: false, Rect: bsRect{0, 200, 100, 40}}, // screen 2: no C
		},
		Steps: []bsStep{
			{Msg: pickMsg(map[string]any{"list": "C"})},
			{Boxes: map[string]bool{"0": false, "1": true}}, // the person moves to screen 2
			{Msg: pickMsg(map[string]any{"list": "B"})},
			{Msg: pickMsg(map[string]any{})},
		},
	})
	picked := out.CSS[1]
	wantDefault := `[data-dc-slot]:not(` + hasC + `) > [data-dc-variant] ~ [data-dc-variant] {display: none !important}`
	for _, want := range []string{wantDefault, pickC} {
		if !strings.Contains(picked, want) {
			t.Errorf("style after picking C lacks %q:\n%s", want, picked)
		}
	}
	// no rule names the slot without asking for its picked letter, so a slot without C is never hidden by it
	for line := range strings.SplitSeq(strings.TrimSpace(picked), "\n") {
		if strings.Contains(line, `data-dc-slot="list"`) && !strings.Contains(line, `:has(> [data-dc-variant="C"])`) {
			t.Errorf("a rule for the picked slot is not scoped to slots that have C: %s", line)
		}
	}
	// the slot is reported with what shows: C where it has C, its first variant where it lacks C
	if got := out.posted(t, 0, "arc-canvas-proto"); len(got) != 1 || got[0].Slots[0].Picked != "C" {
		t.Errorf("report after picking C: %+v, want list showing C", got)
	}
	got := out.posted(t, 1, "arc-canvas-proto")
	if len(got) != 1 || len(got[0].Slots) != 1 || got[0].Slots[0].Picked != "A" || strings.Join(got[0].Slots[0].Letters, "") != "AB" {
		t.Errorf("report on the screen with no C: %+v, want list A/B showing A", got)
	}
	if out.CSS[2] != picked {
		t.Errorf("moving to another screen rewrote the style:\n%s\nwas\n%s", out.CSS[2], picked)
	}
	if got := out.posted(t, 2, "arc-canvas-proto"); len(got) != 1 || got[0].Slots[0].Picked != "B" {
		t.Errorf("report after picking B: %+v, want list showing B", got)
	}
	if strings.TrimSpace(out.CSS[4]) != defaultRule {
		t.Errorf("style after clearing the picks: %q, want only the default rule", out.CSS[4])
	}
	if out.Styles != 1 {
		t.Errorf("%d <style> elements in head after four picks, want the one rewritten", out.Styles)
	}
}

func TestBoardScriptExcludesEveryPickedSlotFromTheDefaultRule(t *testing.T) {
	out := runBoardScript(t, bsIn{
		Steps: []bsStep{{Msg: pickMsg(map[string]any{"menu": "B", "list": "C"})}},
	})
	want := `[data-dc-slot]:not(` + hasC + `, [data-dc-slot="menu"]:has(> [data-dc-variant="B"])) > [data-dc-variant] ~ [data-dc-variant] {display: none !important}`
	if !strings.Contains(out.CSS[1], want) {
		t.Errorf("style lacks %q:\n%s", want, out.CSS[1])
	}
}

func TestBoardScriptTakesPicksOnlyFromItsParentAndOnlyWellFormed(t *testing.T) {
	out := runBoardScript(t, bsIn{
		Steps: []bsStep{
			{Msg: pickMsg(map[string]any{"list": "B"}), From: "other"},
			{Msg: map[string]any{"type": "arc-canvas-other", "picks": map[string]any{"list": "B"}}},
			{Msg: pickMsg(map[string]any{"list": 5, "": "A", "menu": "", "ok": "B"})},
			{Msg: map[string]any{"type": "arc-canvas-slot-pick"}},
		},
	})
	for i := 1; i <= 2; i++ {
		if strings.TrimSpace(out.CSS[i]) != defaultRule {
			t.Errorf("style after step %d: %q, want only the default rule", i-1, out.CSS[i])
		}
	}
	if !strings.Contains(out.CSS[3], `[data-dc-slot="ok"]:has(> [data-dc-variant="B"])`) ||
		strings.Contains(out.CSS[3], `"list"`) || strings.Contains(out.CSS[3], `"menu"`) || strings.Contains(out.CSS[3], `[data-dc-slot=""]`) {
		t.Errorf("style after a pick with bad entries:\n%s\nwant only the well-formed ok = B", out.CSS[3])
	}
	if strings.TrimSpace(out.CSS[4]) != defaultRule {
		t.Errorf("style after a pick with no map: %q, want only the default rule", out.CSS[4])
	}
}

func TestBoardScriptEscapesWhatItPutsInASelector(t *testing.T) {
	out := runBoardScript(t, bsIn{
		Steps: []bsStep{{Msg: pickMsg(map[string]any{"a\"b\\c": "D"})}},
	})
	if want := `[data-dc-slot="a\"b\\c"]:has(> [data-dc-variant="D"])`; !strings.Contains(out.CSS[1], want) {
		t.Errorf("style lacks the escaped %q:\n%s", want, out.CSS[1])
	}
}
