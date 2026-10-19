// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestVerifChecks(t *testing.T) {
	nodeEdit := "cd \"C:/w\" && node -e '\nconst fs=require(\"fs\");const p=\"scripts/cdp/final-verify.test.mjs\";\nfs.writeFileSync(p,s);' && sed -n 209p scripts/cdp/final-verify.test.mjs; npx vitest run scripts/cdp/final-verify.test.mjs 2>&1 | tail -25"
	mutate := `cp scripts/cdp/final-verify.mjs "$TMP/fv.bak" && sed -i 's|a|b|' scripts/cdp/final-verify.mjs && npx vitest run scripts/cdp/final-verify.test.mjs -t "one after the other" 2>&1 | head -20; cp "$TMP/fv.bak" scripts/cdp/final-verify.mjs`
	heredoc := "node - <<'EOF'\nconst x = 1;\ngo test ./pkg/fake/\nEOF\nnpx vitest run a.test.ts"
	cases := []struct {
		cmd  string
		want []string
	}{
		// runner-led invocations classify; prose that merely mentions a test/build word does not
		{"pnpm test coupons", []string{"pnpm test coupons"}},
		{"pnpm typecheck", []string{"pnpm typecheck"}},
		{"npm run lint", []string{"npm run lint"}},
		{"go test ./...", []string{"go test ./..."}},
		{"vitest run", []string{"vitest run"}},
		{"pytest -q", []string{"pytest -q"}},
		{"npx tsc --noEmit", []string{"npx tsc --noEmit"}},
		{"pnpm build", []string{"pnpm build"}},
		{"echo hi && pnpm test", []string{"pnpm test"}},
		{"ls -la", nil},
		{`git commit -m "test: add auth"`, nil},
		{"echo build it", nil},
		{"git diff --stat", nil},
		{`git commit -m "build: bump deps"`, nil},
		// finding 21's four commands
		{`grep -rn "landing" frontend --include=*.ts | grep -iv "^.*test" | head -20; grep -rln "landing" pkg --include=*.go`, nil},
		{"go test ./pkg/jarvis/ -run EffectiveLanding 2>&1 | tail -3; go test ./pkg/orchestrate/ 2>&1 | tail -3", []string{"go test ./pkg/jarvis/ -run EffectiveLanding 2>&1", "go test ./pkg/orchestrate/ 2>&1"}},
		{"git diff frontend/types/gotypes.d.ts && go test ./pkg/jarvis/ 2>&1 | tail -30", []string{"go test ./pkg/jarvis/ 2>&1"}},
		{"sed -i '599s/a/b/' pkg/waveobj/wtype.go && task generate && go build ./... && go vet ./pkg/...", []string{"go build ./...", "go vet ./pkg/..."}},
		// run 2993e463's lead: an edit, then a test
		{nodeEdit, []string{"npx vitest run scripts/cdp/final-verify.test.mjs 2>&1"}},
		{mutate, []string{`npx vitest run scripts/cdp/final-verify.test.mjs -t "one after the other" 2>&1`}},
		{heredoc, []string{"npx vitest run a.test.ts"}},
		// inline scripts are edits or probes
		{`node -e 'require("fs").writeFileSync("a.test.ts", "")'`, nil},
		{`python -c "import pytest"`, nil},
		// checks by name
		{"go vet ./pkg/...", []string{"go vet ./pkg/..."}},
		{"task check:ts", []string{"task check:ts"}},
		{"npx prettier --check a.ts", []string{"npx prettier --check a.ts"}},
		{"git checkout main", nil},
		// a runner behind env (quoted too), a cd, a path, or .exe
		{"CGO_ENABLED=0 GOOS=linux go test ./pkg/...", []string{"CGO_ENABLED=0 GOOS=linux go test ./pkg/..."}},
		{`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/orchestrate/ -count=1`, []string{`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/orchestrate/ -count=1`}},
		{`cd "C:/work/tree" && npm test`, []string{"npm test"}},
		{`C:\Go\bin\go.exe test ./...`, []string{`C:\Go\bin\go.exe test ./...`}},
		{"./node_modules/.bin/vitest run", []string{"./node_modules/.bin/vitest run"}},
		{"node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit", []string{"node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit"}},
		// an edit or a search alone is not a check
		{"sed -i 's/test/spec/' pkg/x_test.go", nil},
		{"rg -n 'go test' docs", nil},
	}
	for _, c := range cases {
		if got := verifChecks(c.cmd); !slices.Equal(got, c.want) {
			t.Errorf("verifChecks(%q) = %q, want %q", c.cmd, got, c.want)
		}
	}
}

func TestTranscriptSealsOnlyTheCheckAfterAnEdit(t *testing.T) {
	acc := newVerifAccum()
	acc.addTranscript([]string{
		verifToolUseLine("b1", `node -e 'require("fs").writeFileSync("a.ts", "x")' && npx vitest run a.test.ts 2>&1 | tail -5`),
		verifResultLine("b1", false, "Tests  1 failed"),
		verifToolUseLine("b2", `sed -i 's/x/y/' a.ts && npx vitest run a.test.ts 2>&1 | tail -5`),
		verifResultLine("b2", false, "Tests  1 passed"),
	})
	if len(acc.out) != 1 || acc.out[0].Cmd != "npx vitest run a.test.ts 2>&1" || acc.out[0].Detail != "Tests  1 passed" {
		t.Fatalf("got %+v, want one line holding only the test and its last result", acc.out)
	}
}

func TestTranscriptVerifsReadRanWhateverTheOutcome(t *testing.T) {
	acc := newVerifAccum()
	acc.addTranscript([]string{
		verifToolUseLine("b1", "go test ./pkg/x/ 2>&1 | tail -3"),
		verifResultLine("b1", false, "FAIL\tpkg/x\t0.4s"), // the pipe hid the failure's exit code
		verifToolUseLine("b2", "npm test"),
		verifResultLine("b2", true, "1 failing"),
		verifToolUseLine("b3", "pnpm typecheck"),
		verifResultLine("b3", false, ""),
		verifToolUseLine("b4", "go build ./..."), // no result at all
	})
	if len(acc.out) != 4 {
		t.Fatalf("want 4 lines, got %+v", acc.out)
	}
	for _, v := range acc.out {
		if v.Result != VerifResult_Ran {
			t.Errorf("%q result = %q, want %q", v.Cmd, v.Result, VerifResult_Ran)
		}
	}
	if acc.out[0].Detail != "FAIL\tpkg/x\t0.4s" {
		t.Errorf("detail must keep the runner's summary, got %q", acc.out[0].Detail)
	}
}

func TestParseNumstatStatus(t *testing.T) {
	numstat := "96\t0\tcomponents/CouponInput.tsx\n41\t12\tlib/cart/totals.ts\n"
	statusZ := "A  components/CouponInput.tsx\x00 M lib/cart/totals.ts\x00"
	files := parseNumstatStatus(numstat, statusZ)
	if len(files) != 2 {
		t.Fatalf("got %d files, want 2", len(files))
	}
	if files[0].Stat != "A" || files[0].Add != 96 || files[0].Del != 0 {
		t.Errorf("file0 = %+v", files[0])
	}
	if files[1].Stat != "M" || files[1].Add != 41 || files[1].Del != 12 {
		t.Errorf("file1 = %+v", files[1])
	}
}

func TestArtifactKind(t *testing.T) {
	for path, want := range map[string]string{
		"docs/coupon-design.md":    "doc",
		"coverage/coupons.html":    "report",
		"screenshots/checkout.png": "image",
		"build/out.bin":            "file",
	} {
		if got := artifactKind(path); got != want {
			t.Errorf("artifactKind(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestEvidenceRoute(t *testing.T) {
	cases := map[string]struct {
		run                    waveobj.Run
		observed               string
		wantHarness, wantModel string
	}{
		"transcript model wins over the pinned one": {waveobj.Run{Runtime: "claude", Model: "claude-sonnet-5"}, "claude-opus-5", "claude", "claude-opus-5"},
		"pinned model when the transcript names none": {waveobj.Run{Runtime: "pi", Model: "deepseek-v4-flash"}, "", "pi", "deepseek-v4-flash"},
		"empty runtime is the default runtime":        {waveobj.Run{}, "claude-opus-5", runroute.DefaultRuntime(""), "claude-opus-5"},
		"neither known leaves model empty":            {waveobj.Run{Runtime: "claude"}, "", "claude", ""},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			h, m := evidenceRoute(&c.run, c.observed)
			if h != c.wantHarness || m != c.wantModel {
				t.Fatalf("evidenceRoute = (%q, %q), want (%q, %q)", h, m, c.wantHarness, c.wantModel)
			}
		})
	}
}

func TestFinalAssistantText(t *testing.T) {
	lines := []string{
		`{"type":"user","message":{"content":"go"}}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"t1"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"all done, shipped it"}]}}`,
	}
	if got := finalAssistantText(lines); got != "all done, shipped it" {
		t.Errorf("finalAssistantText = %q", got)
	}
}

func TestVerificationCommandsDedupesAndClassifies(t *testing.T) {
	lines := []string{
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"b1","input":{"command":"pnpm typecheck"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b1","is_error":false,"content":"0 errors"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"b2","input":{"command":"pnpm test"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b2","is_error":true,"content":"1 failing"}]}}`,
	}
	v := verificationCommands(lines)
	if len(v) != 2 {
		t.Fatalf("got %d verifs, want 2", len(v))
	}
	if v[0].Result != VerifResult_Ran || v[1].Result != VerifResult_Ran {
		t.Errorf("results = %q,%q", v[0].Result, v[1].Result)
	}
}

func TestVerificationCommandsRejectsProseCommands(t *testing.T) {
	// commands that merely mention a test/build word (commit messages, echoes) must not appear in the
	// snapshot at all — not even as "unknown" when they have no tool_result (the pending-map tail).
	lines := []string{
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"b1","input":{"command":"git commit -m \"test: add auth\""}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b1","is_error":false,"content":"[main abc1234] test: add auth"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"b2","input":{"command":"echo build it"}}]}}`,
	}
	v := verificationCommands(lines)
	if len(v) != 0 {
		t.Fatalf("got %d verifs, want 0 (prose commands must not be reported): %+v", len(v), v)
	}
}

func TestVerificationDetailStripsANSI(t *testing.T) {
	// vitest/tsc emit colorized output when a TTY is attached; the detail must be plain text.
	// json.Marshal encodes the ESC bytes as a captured transcript stores them (escaped), so the
	// fixture stays valid JSON while carrying real escapes for StripANSI to remove. The escapes sit on
	// the summary line because that is the line verifSummaryLine reports.
	ansi, _ := json.Marshal("\x1b[36m RUN \x1b[39m checkout\n\x1b[1m\x1b[32mTests  \x1b[36mv3.2.4\x1b[39m 12 passed\x1b[39m\x1b[22m")
	lines := []string{
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"b1","input":{"command":"npx vitest run"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b1","is_error":false,"content":` + string(ansi) + `}]}}`,
	}
	v := verificationCommands(lines)
	if len(v) != 1 {
		t.Fatalf("got %d verifs, want 1", len(v))
	}
	if strings.ContainsRune(v[0].Detail, '\x1b') {
		t.Errorf("detail still carries ANSI escapes: %q", v[0].Detail)
	}
	if !strings.Contains(v[0].Detail, "Tests") || !strings.Contains(v[0].Detail, "v3.2.4") {
		t.Errorf("detail lost its content after stripping: %q", v[0].Detail)
	}
}

func TestVerifSummaryLine(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"pytest band", "rootdir: C:\\p\nplugins: anyio\ntests/t.py ....\n\n===== 12 passed in 3.42s =====\n", "===== 12 passed in 3.42s ====="},
		{"pytest failures", "tests/t.py F..\n\n2 failed, 10 passed in 1.1s", "2 failed, 10 passed in 1.1s"},
		{"go test ok", "=== RUN   TestFoo\n--- PASS: TestFoo (0.00s)\nok  \tpkg/jarvis\t0.412s", "ok  \tpkg/jarvis\t0.412s"},
		{"go test fail below trailing noise", "--- FAIL: TestBar (0.01s)\nFAIL\tpkg/jarvis\t0.4s\nFAIL", "FAIL\tpkg/jarvis\t0.4s"},
		{"tsc error count", "src/a.ts(3,1): error TS2304: Cannot find name 'x'.\n\nFound 1 error in src/a.ts\n", "Found 1 error in src/a.ts"},
		{"no summary falls back to the last non-empty line", "building...\nwrote dist/app.js\n\n", "wrote dist/app.js"},
		{"empty stays empty", "\n  \n", ""},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := verifSummaryLine(tt.in); got != tt.want {
				t.Errorf("verifSummaryLine() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestVerificationDetailPrefersTheSummaryOverTheFirstLine(t *testing.T) {
	// workers commonly pipe verification through `| tail -N`, so the captured stdout already starts
	// mid-run: its first line is an arbitrary fragment while the result summary is on the last line.
	out, _ := json.Marshal("rootdir: C:\\Users\\me\\proj\nplugins: anyio-4.4.0\ntests/test_state.py ....\n\n===== 12 passed in 3.42s =====\n")
	lines := []string{
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"b1","input":{"command":"pytest tests/ | tail -20"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b1","is_error":false,"content":` + string(out) + `}]}}`,
	}
	v := verificationCommands(lines)
	if len(v) != 1 {
		t.Fatalf("got %d verifs, want 1", len(v))
	}
	if !strings.Contains(v[0].Detail, "12 passed") {
		t.Errorf("detail = %q, want the pytest result summary", v[0].Detail)
	}
}

// verifToolUseLine / verifResultLine / textLine build transcript JSONL records for one Bash
// verification call (the shapes verificationCommands scans).
func verifToolUseLine(id, command string) string {
	b, _ := json.Marshal(map[string]any{
		"type": "assistant",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "tool_use", "name": "Bash", "id": id, "input": map[string]any{"command": command}},
		}},
	})
	return string(b)
}

func verifResultLine(id string, isError bool, out string) string {
	b, _ := json.Marshal(map[string]any{
		"type": "user",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "tool_result", "tool_use_id": id, "is_error": isError, "content": out},
		}},
	})
	return string(b)
}

func textLine(text string) string {
	b, _ := json.Marshal(map[string]any{
		"type": "assistant",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "text", "text": text},
		}},
	})
	return string(b)
}

// seedWorkerTranscript creates a worker tab+block (cwd = projDir) and a transcript JSONL for it in
// the real Claude projects dir. The projects-dir entry is the slug of the unique projDir, so no user
// project dir is touched; the created entry is removed on cleanup. Returns the tab oref.
func seedWorkerTranscript(t *testing.T, projDir string, lines []string) string {
	t.Helper()
	ctx := context.Background()
	tabOID := uuid.NewString()
	blockOID := uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabOID, Name: "worker", BlockIds: []string{blockOID}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatalf("seed worker tab: %v", err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockOID, Meta: waveobj.MetaMapType{waveobj.MetaKey_CmdCwd: projDir}}); err != nil {
		t.Fatalf("seed worker block: %v", err)
	}
	projRoot := filepath.Join(wavebase.GetHomeDir(), ".claude", "projects", agentobserve.SlugifyCwd(projDir))
	if err := os.MkdirAll(projRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(projRoot) })
	var b strings.Builder
	cwdJSON, _ := json.Marshal(projDir)
	b.WriteString(`{"type":"user","cwd":` + string(cwdJSON) + "}\n") // discovery re-validates the slug via the in-record cwd
	for _, line := range lines {
		b.WriteString(line)
		b.WriteString("\n")
	}
	if err := os.WriteFile(filepath.Join(projRoot, "transcript.jsonl"), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
}

// TestSealEvidenceAggregatesVerifsAcrossWorkers proves the sealed snapshot carries the verification
// commands of EVERY non-skipped phase worker, not just the last phase's first worker: phase 1's and
// phase 2's workers each ran a distinct verification, and a skipped phase 3's worker must not leak
// in. First-appearance order is phase order; the summary stays the last worker's.
func TestSealEvidenceAggregatesVerifsAcrossWorkers(t *testing.T) {
	proj := t.TempDir()
	phase1Worker := seedWorkerTranscript(t, t.TempDir(), []string{
		verifToolUseLine("b1", "pnpm typecheck"),
		verifResultLine("b1", false, "0 errors"),
		textLine("phase one summary"),
	})
	phase2Worker := seedWorkerTranscript(t, t.TempDir(), []string{
		verifToolUseLine("b2", "go test ./..."),
		verifResultLine("b2", false, "ok\tpkg/jarvis\t0.4s"),
		textLine("phase two summary"),
	})
	skippedWorker := seedWorkerTranscript(t, t.TempDir(), []string{
		verifToolUseLine("b3", "pnpm lint"),
		verifResultLine("b3", false, "no problems"),
	})

	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: proj, CreatedTs: 1000,
		Phases: []waveobj.RunPhase{
			{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 3000, WorkerOrefs: []string{phase1Worker}},
			{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000, WorkerOrefs: []string{phase2Worker}},
			{Kind: PhaseKind_Execute, State: PhaseState_Skipped, DoneTs: 6000, WorkerOrefs: []string{skippedWorker}},
		},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence == nil {
		t.Fatal("evidence not sealed")
	}
	if len(run.Evidence.Verifs) != 2 {
		t.Fatalf("got %d verifs, want 2 (both non-skipped workers, skipped phase excluded): %+v", len(run.Evidence.Verifs), run.Evidence.Verifs)
	}
	if run.Evidence.Verifs[0].Cmd != "pnpm typecheck" || run.Evidence.Verifs[0].Result != VerifResult_Ran {
		t.Errorf("verif[0] = %+v, want pnpm typecheck/ran (first-appearance order)", run.Evidence.Verifs[0])
	}
	if run.Evidence.Verifs[1].Cmd != "go test ./..." || run.Evidence.Verifs[1].Result != VerifResult_Ran {
		t.Errorf("verif[1] = %+v, want go test ./.../ran", run.Evidence.Verifs[1])
	}
	if run.Evidence.Summary != "phase two summary" {
		t.Errorf("Summary = %q, want the last worker's text only", run.Evidence.Summary)
	}
}

// a branch run's lead writes its relative artifacts in the landing tree, not the checkout
func TestSealEvidenceSizesArtifactsInTheLandingTree(t *testing.T) {
	tree := t.TempDir()
	if err := os.WriteFile(filepath.Join(tree, "report.md"), []byte("landed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: t.TempDir(), LandPath: tree, CreatedTs: 1000,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 3000, Artifacts: []string{"report.md"}}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if arts := run.Evidence.Artifacts; len(arts) != 1 || arts[0].Size != int64(len("landed\n")) {
		t.Fatalf("artifacts = %+v, want report.md sized from the landing tree", arts)
	}
}

// TestSealEvidenceVerifDedupeAcrossWorkers guards the cross-transcript dedupe: the same command run
// by two workers collapses to one entry, keeping its first-appearance position, and the last result
// wins (the per-transcript semantic extended across transcripts).
func TestSealEvidenceVerifDedupeAcrossWorkers(t *testing.T) {
	w1 := seedWorkerTranscript(t, t.TempDir(), []string{
		verifToolUseLine("b1", "pnpm test"),
		verifResultLine("b1", true, "1 failing"),
	})
	w2 := seedWorkerTranscript(t, t.TempDir(), []string{
		verifToolUseLine("b2", "pnpm test"),
		verifResultLine("b2", false, "12 passed"),
	})
	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000,
		Phases: []waveobj.RunPhase{
			{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 3000, WorkerOrefs: []string{w1}},
			{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000, WorkerOrefs: []string{w2}},
		},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	v := run.Evidence.Verifs
	if len(v) != 1 {
		t.Fatalf("got %d verifs, want 1 (deduped across workers): %+v", len(v), v)
	}
	if v[0].Cmd != "pnpm test" || v[0].Result != VerifResult_Ran || v[0].Detail != "12 passed" {
		t.Errorf("verif = %+v, want pnpm test/ran/12 passed (last result wins across workers)", v[0])
	}
}

func gitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestSealEvidenceBaseAnchored(t *testing.T) {
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "init")
	base, err := gitinfo.HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	// the run's work: modify + commit on top of the base
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "commit", "-am", "work")

	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: dir, BaseCommit: base, CreatedTs: 1000,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence == nil || len(run.Evidence.Files) == 0 {
		t.Fatalf("expected committed files in evidence, got %+v", run.Evidence)
	}
	if run.Evidence.AddTotal == 0 {
		t.Fatalf("expected AddTotal > 0, got %d", run.Evidence.AddTotal)
	}
}

// TestSealEvidenceRecordsRoute proves the seal wires the run's actual route (harness + observed model)
// into the evidence, using a stubbed observedModelFn so the test does not need a real transcript on disk.
func TestSealEvidenceRecordsRoute(t *testing.T) {
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "init")
	base, err := gitinfo.HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}

	prev := observedModelFn
	observedModelFn = func(*waveobj.Run) string { return "claude-opus-5" }
	t.Cleanup(func() { observedModelFn = prev })

	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: dir, BaseCommit: base, CreatedTs: 1000, Runtime: "claude",
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence.Harness != "claude" || run.Evidence.Model != "claude-opus-5" {
		t.Errorf("Evidence route = (%q, %q), want (claude, claude-opus-5)", run.Evidence.Harness, run.Evidence.Model)
	}
}

// RunRoute reads the model from the last worker of the last non-skipped phase whose transcript resolves: a
// skipped phase's worker never counts, and a torn-down worker tab falls back to the one before it.
func TestRunRouteReadsTheLastResolvableWorkerModel(t *testing.T) {
	// a transcript is a session only once it carries a prompt
	turn := func(model string) []string {
		return []string{
			`{"type":"user","message":{"content":"do the task"}}`,
			`{"type":"assistant","message":{"model":"` + model + `","content":[{"type":"text","text":"done"}]}}`,
		}
	}
	worker := seedWorkerTranscript(t, t.TempDir(), turn("claude-opus-4-8"))
	skipped := seedWorkerTranscript(t, t.TempDir(), turn("claude-skipped-9"))
	gone := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	run := &waveobj.Run{
		ID: "r1", Runtime: "claude", Model: "pinned-model",
		Phases: []waveobj.RunPhase{
			{Kind: PhaseKind_Execute, State: PhaseState_Done, WorkerOrefs: []string{worker, gone}},
			{Kind: PhaseKind_Execute, State: PhaseState_Skipped, WorkerOrefs: []string{skipped}},
		},
	}
	if harness, model := RunRoute(run); harness != "claude" || model != "claude-opus-4-8" {
		t.Fatalf("RunRoute = (%q, %q), want (claude, claude-opus-4-8)", harness, model)
	}
}

// The engine closes an orchestrator lead's tab mid-turn on `wsh jarvis complete`, so the lead's own
// wrap-up text never reaches a transcript SealEvidence can read. The report it sent with --report is the
// only way that text survives into the sealed summary.
func TestSealEvidenceUsesTheCompleteReport(t *testing.T) {
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "init")
	base, err := gitinfo.HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}

	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: dir, BaseCommit: base, CreatedTs: 1000,
		Report: "landed 3 tasks, forwarded 1",
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence.Summary != "landed 3 tasks, forwarded 1" {
		t.Errorf("summary = %q, want the complete's report", run.Evidence.Summary)
	}
}

// Without a report, the sealed summary still falls back to the last worker's final transcript text, as
// before --report existed.
func TestSealEvidenceFallsBackToTheTranscriptWithoutAReport(t *testing.T) {
	const sessionId = "0b6f7c1e-4d2a-4f3b-9c8d-1a2b3c4d5e6f"
	root := t.TempDir()
	prev := transcriptRootFor
	transcriptRootFor = func(string) string { return root }
	t.Cleanup(func() { transcriptRootFor = prev })
	proj := t.TempDir()
	writeSessionLines(t, filepath.Join(root, agentobserve.SlugifyCwd(proj), sessionId+".jsonl"), []string{
		textLine("all done"),
	})

	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: proj, CreatedTs: 1000, Runtime: "claude", SessionId: sessionId,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000, WorkerOrefs: []string{"tab:" + uuid.NewString()}}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence.Summary != "all done" {
		t.Errorf("summary = %q, want the worker's last message", run.Evidence.Summary)
	}
}

func TestSealEvidenceGitFailureLeavesUnsealed(t *testing.T) {
	// a canceled context fails the git-changes computation; evidence must be left unsealed (nil) with an
	// error so the backfill can retry, not frozen into an empty (and immutable) file list.
	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := SealEvidence(ctx, run); err == nil {
		t.Fatal("expected an error when the git-changes computation is canceled")
	}
	if run.Evidence != nil {
		t.Fatal("evidence must be left unsealed on a git failure/timeout")
	}
}

func TestEvidenceHashStable(t *testing.T) {
	ev := waveobj.RunEvidence{Summary: "x", AddTotal: 3}
	if evidenceHash(ev) != evidenceHash(ev) {
		t.Error("hash not stable for identical input")
	}
}

func TestSealEvidenceIdempotent(t *testing.T) {
	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence == nil {
		t.Fatal("evidence not sealed")
	}
	if run.CompletedTs != 5000 {
		t.Fatalf("CompletedTs = %d, want 5000 (last phase DoneTs)", run.CompletedTs)
	}
	first := run.Evidence
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence != first {
		t.Error("second seal recomputed evidence; must be immutable no-op")
	}
}

// piWorkerEntries is a pi v3 session's records after its header, each parented on the one before as pi
// writes them: the task, an assistant turn running a bash command, its result, and a closing message.
func piWorkerEntries(command string, isError bool, summary string) []string {
	entry := func(id string, parent any, message map[string]any) string {
		b, _ := json.Marshal(map[string]any{"type": "message", "id": id, "parentId": parent, "timestamp": "2026-09-15T03:10:10.831Z", "message": message})
		return string(b)
	}
	text := func(s string) []any { return []any{map[string]any{"type": "text", "text": s}} }
	return []string{
		entry("e1", nil, map[string]any{"role": "user", "content": text("do the task")}),
		entry("e2", "e1", map[string]any{"role": "assistant", "content": []any{
			map[string]any{"type": "text", "text": "running the tests"},
			map[string]any{"type": "toolCall", "id": "call_1", "name": "bash", "arguments": map[string]any{"command": command}},
		}}),
		entry("e3", "e2", map[string]any{"role": "toolResult", "toolCallId": "call_1", "toolName": "bash", "isError": isError, "content": text("FAIL\tpkg/x\t0.4s")}),
		entry("e4", "e3", map[string]any{"role": "assistant", "content": text(summary)}),
	}
}

// pi records a turn as a message entry: the assistant's content carries text and toolCall blocks, and a
// tool's output comes back as its own toolResult message. Evidence reads the same summary and
// verifications from it that it reads from a claude transcript.
func TestPiTranscriptProjectsToEvidence(t *testing.T) {
	lines := piWorkerEntries("go test ./...", true, "all done")
	if got := finalAssistantText(lines); got != "all done" {
		t.Errorf("finalAssistantText = %q", got)
	}
	v := verificationCommands(lines)
	if len(v) != 1 || v[0].Cmd != "go test ./..." || v[0].Result != VerifResult_Ran {
		t.Fatalf("verifs = %+v, want the failed go test", v)
	}
}

func writeSessionLines(t *testing.T, path string, lines []string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A worker launched with --session-id is read from the transcript named by that id, for either runtime,
// without going through its tab.
func TestSealEvidenceReadsTheSessionTranscript(t *testing.T) {
	const sessionId = "0b6f7c1e-4d2a-4f3b-9c8d-1a2b3c4d5e6f"
	for _, runtime := range []string{"claude", "pi"} {
		t.Run(runtime, func(t *testing.T) {
			root := t.TempDir()
			prev := transcriptRootFor
			transcriptRootFor = func(string) string { return root }
			t.Cleanup(func() { transcriptRootFor = prev })
			proj := t.TempDir()
			if runtime == "claude" {
				writeSessionLines(t, filepath.Join(root, agentobserve.SlugifyCwd(proj), sessionId+".jsonl"), []string{
					verifToolUseLine("b1", "go test ./..."),
					verifResultLine("b1", true, "FAIL\tpkg/x\t0.4s"),
					textLine("all done"),
				})
			} else {
				header, _ := json.Marshal(map[string]any{"type": "session", "version": 3, "id": sessionId, "timestamp": "2026-09-15T03:10:10.831Z", "cwd": proj})
				writeSessionLines(t, filepath.Join(root, "--proj--", "2026-09-15T03-10-10-831Z_"+sessionId+".jsonl"),
					append([]string{string(header)}, piWorkerEntries("go test ./...", true, "all done")...))
			}
			run := &waveobj.Run{
				ID: "r1", Status: RunStatus_Done, ProjectPath: proj, CreatedTs: 1000, Runtime: runtime, SessionId: sessionId,
				Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000, WorkerOrefs: []string{"tab:" + uuid.NewString()}}},
			}
			if err := SealEvidence(context.Background(), run); err != nil {
				t.Fatal(err)
			}
			if run.Evidence.Summary != "all done" {
				t.Errorf("summary = %q, want the worker's last message", run.Evidence.Summary)
			}
			if len(run.Evidence.Verifs) != 1 || run.Evidence.Verifs[0].Result != VerifResult_Ran {
				t.Errorf("verifs = %+v, want the failed go test", run.Evidence.Verifs)
			}
		})
	}
}

// A worker's transcript is found by its session id after its worktree is gone, and a run launched without
// one has none to find.
func TestSessionTranscriptPathFindsTheWorkerTranscript(t *testing.T) {
	const sessionId = "0b6f7c1e-4d2a-4f3b-9c8d-1a2b3c4d5e6f"
	root := t.TempDir()
	prev := transcriptRootFor
	transcriptRootFor = func(string) string { return root }
	t.Cleanup(func() { transcriptRootFor = prev })
	worktree := filepath.Join(t.TempDir(), "removed-worktree")
	want := filepath.Join(root, agentobserve.SlugifyCwd(worktree), sessionId+".jsonl")
	writeSessionLines(t, want, []string{textLine("all done")})

	run := &waveobj.Run{ID: "r1", Runtime: "claude", ProjectPath: worktree, SessionId: sessionId}
	if got := SessionTranscriptPath(run); got != want {
		t.Errorf("path = %q, want %q", got, want)
	}
	run.SessionId = ""
	if got := SessionTranscriptPath(run); got != "" {
		t.Errorf("path without a session id = %q, want none", got)
	}
}

// TestSealEvidenceScopesToEndCommit is the fan-out over-attribution guard: with EndCommit set, evidence
// must reflect only the run's own commit (mine.txt), never a sibling that merged into the shared tree
// afterward (sibling.txt) — which a working-tree-vs-baseline diff (today's behavior) would wrongly list.
func TestSealEvidenceScopesToEndCommit(t *testing.T) {
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "base")
	base, err := gitinfo.HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	// this run's own commit
	if err := os.WriteFile(filepath.Join(dir, "mine.txt"), []byte("x\ny\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "mine")
	mine, err := gitinfo.HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	// a sibling's work merged onto the shared tree AFTER this run's commit (would leak into a base diff)
	if err := os.WriteFile(filepath.Join(dir, "sibling.txt"), []byte("s\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "sibling")

	run := &waveobj.Run{
		ID: "r1", Status: RunStatus_Done, ProjectPath: dir, BaseCommit: base, EndCommit: mine, CreatedTs: 1000,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if run.Evidence == nil {
		t.Fatal("expected sealed evidence")
	}
	paths := map[string]bool{}
	for _, f := range run.Evidence.Files {
		paths[f.Path] = true
	}
	if !paths["mine.txt"] {
		t.Errorf("expected mine.txt, got files %+v", run.Evidence.Files)
	}
	if paths["sibling.txt"] {
		t.Errorf("sibling.txt (merged after EndCommit) leaked into evidence: %+v", run.Evidence.Files)
	}
}

// sharedMainRepo lays down, on one branch: base, a lane commit of run R, a commit from another session,
// the lead's own fix, and a commit from run R2 whose id shares R's prefix.
func sharedMainRepo(t *testing.T) (dir, base, end string) {
	t.Helper()
	dir = t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	commit := func(file, msg string) string {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, file), []byte(file+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		gitCmd(t, dir, "add", ".")
		gitCmd(t, dir, "commit", "-m", msg)
		head, err := gitinfo.HeadCommit(context.Background(), dir)
		if err != nil {
			t.Fatal(err)
		}
		return head
	}
	base = commit("base.txt", "base")
	commit("lane.txt", "lane\n\nArc-Run: R-t-1")
	commit("other.txt", "another session")
	commit("lead.txt", "lead fix\n\nArc-Run: R")
	end = commit("r2.txt", "another run\n\nArc-Run: R2-t-1")
	return dir, base, end
}

func sealedPaths(t *testing.T, run *waveobj.Run) map[string]bool {
	t.Helper()
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	paths := map[string]bool{}
	for _, f := range run.Evidence.Files {
		paths[f.Path] = true
	}
	return paths
}

// a checkout-landed run shares main with other sessions, so only commits carrying its Arc-Run marker count
func TestSealEvidenceCountsOnlyACheckoutRunsOwnCommits(t *testing.T) {
	dir, base, end := sharedMainRepo(t)
	run := &waveobj.Run{
		ID: "R", Status: RunStatus_Done, ProjectPath: dir, DagORef: uuid.NewString(), BaseCommit: base, EndCommit: end, CreatedTs: 1000,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	paths := sealedPaths(t, run)
	want := map[string]bool{"lane.txt": true, "lead.txt": true}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("files = %v, want %v", paths, want)
	}
	if run.Evidence.AddTotal != 2 {
		t.Errorf("AddTotal = %d, want 2", run.Evidence.AddTotal)
	}
}

// a branch-landed run's range is the branch's own history, so it keeps the plain range diff
func TestSealEvidenceKeepsTheRangeForABranchRun(t *testing.T) {
	dir, base, end := sharedMainRepo(t)
	run := &waveobj.Run{
		ID: "R", Status: RunStatus_Done, ProjectPath: dir, LandPath: dir, DagORef: uuid.NewString(), BaseCommit: base, EndCommit: end, CreatedTs: 1000,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	paths := sealedPaths(t, run)
	for _, p := range []string{"lane.txt", "other.txt", "lead.txt", "r2.txt"} {
		if !paths[p] {
			t.Errorf("expected %s in a branch run's range, got %v", p, paths)
		}
	}
}

// TestSealEvidenceFallsBackWithoutEndCommit guards the common single-run case: no reported commit falls
// back to the working-tree-vs-baseline diff, so uncommitted work the worker left is still captured.
func TestSealEvidenceFallsBackWithoutEndCommit(t *testing.T) {
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "base")
	base, err := gitinfo.HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	// uncommitted working-tree change (EndCommit stays empty)
	if err := os.WriteFile(filepath.Join(dir, "wt.txt"), []byte("w\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	run := &waveobj.Run{
		ID: "r2", Status: RunStatus_Done, ProjectPath: dir, BaseCommit: base, CreatedTs: 1000, // EndCommit empty
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, State: PhaseState_Done, DoneTs: 5000}},
	}
	if err := SealEvidence(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range run.Evidence.Files {
		if f.Path == "wt.txt" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected working-tree file wt.txt in fallback, got %+v", run.Evidence.Files)
	}
}

func appendVerifyEvent(t *testing.T, channelID, runID, kind string, detail map[string]any) {
	t.Helper()
	if _, err := wstore.AppendRunEvent(context.Background(), channelID, runID, kind, nil, detail); err != nil {
		t.Fatal(err)
	}
}

// the engine runs Verify, not a worker, so its results live only in the owner run's events
func TestSealEvidenceRecordsTheDagsVerify(t *testing.T) {
	ctx := context.Background()
	runID, channelID := uuid.NewString(), uuid.NewString()
	g := &waveobj.TaskGroup{OID: uuid.NewString(), RunID: runID, ChannelId: channelID, Verify: "go test ./...",
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done"}, {ID: "t-2", State: "verify-failed"}, {ID: "t-3", State: "done"}}}
	g.ID = g.OID
	if err := wstore.AppendDag(ctx, g); err != nil {
		t.Fatal(err)
	}
	// t-1 timed out and its re-run passed; t-2 failed; t-3 never ran Verify
	appendVerifyEvent(t, channelID, runID, waveobj.RunEventKindTaskVerifyFailed, map[string]any{"taskid": "t-1", "reason": "timeout"})
	appendVerifyEvent(t, channelID, runID, waveobj.RunEventKindTaskVerifyPassed, map[string]any{"taskid": "t-1"})
	appendVerifyEvent(t, channelID, runID, waveobj.RunEventKindTaskVerifyFailed, map[string]any{"taskid": "t-2", "reason": "exit 1"})
	run := &waveobj.Run{ID: runID, OID: runID, ChannelOID: channelID, DagORef: g.OID, Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000}
	if err := SealEvidence(ctx, run); err != nil {
		t.Fatal(err)
	}
	want := []waveobj.EvidenceVerif{
		{Cmd: "go test ./...", Result: "pass", Detail: "after t-1"},
		{Cmd: "go test ./...", Result: "fail", Detail: "after t-2: exit 1"},
	}
	if !reflect.DeepEqual(run.Evidence.Verifs, want) {
		t.Fatalf("verifs = %+v, want %+v", run.Evidence.Verifs, want)
	}
}

// a child run shares its owner's dag but is sealed before its Verify runs; the dag's results are the owner's
func TestSealEvidenceGivesAChildRunNoDagVerify(t *testing.T) {
	ctx := context.Background()
	ownerID, childID, channelID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	g := &waveobj.TaskGroup{OID: uuid.NewString(), RunID: ownerID, ChannelId: channelID, Verify: "go test ./...",
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done", RunID: childID}}}
	g.ID = g.OID
	if err := wstore.AppendDag(ctx, g); err != nil {
		t.Fatal(err)
	}
	appendVerifyEvent(t, channelID, ownerID, waveobj.RunEventKindTaskVerifyPassed, map[string]any{"taskid": "t-1"})
	child := &waveobj.Run{ID: childID, OID: childID, ChannelOID: channelID, DagORef: g.OID, Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000}
	if err := SealEvidence(ctx, child); err != nil {
		t.Fatal(err)
	}
	if len(child.Evidence.Verifs) != 0 {
		t.Fatalf("a child run must not carry its owner's Verify, got %+v", child.Evidence.Verifs)
	}
}

// the final stage's outcome is the owner's, sealed whole; a child run of the same dag gets none
func TestSealEvidenceRecordsTheFinalStageOutcome(t *testing.T) {
	ctx := context.Background()
	ownerID, childID, channelID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	reasons := []string{"no dev app: cargo missing", "t-2: the timeout path has no test"}
	g := &waveobj.TaskGroup{OID: uuid.NewString(), RunID: ownerID, ChannelId: channelID,
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done", RunID: childID}},
		Final: &waveobj.FinalStage{State: "unverified", Round: 1, Unverified: reasons}}
	g.ID = g.OID
	if err := wstore.AppendDag(ctx, g); err != nil {
		t.Fatal(err)
	}
	owner := &waveobj.Run{ID: ownerID, OID: ownerID, ChannelOID: channelID, DagORef: g.OID, Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000}
	if err := SealEvidence(ctx, owner); err != nil {
		t.Fatal(err)
	}
	want := &waveobj.RunVerification{State: "unverified", Reasons: reasons}
	if !reflect.DeepEqual(owner.Evidence.Verification, want) {
		t.Fatalf("verification = %+v, want %+v", owner.Evidence.Verification, want)
	}
	child := &waveobj.Run{ID: childID, OID: childID, ChannelOID: channelID, DagORef: g.OID, TaskId: "t-1", Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000}
	if err := SealEvidence(ctx, child); err != nil {
		t.Fatal(err)
	}
	if child.Evidence.Verification != nil {
		t.Fatalf("a child run must not carry its owner's verification, got %+v", child.Evidence.Verification)
	}
}

func structuredReport(differs, notVerified, forLater, foundNotFixed string) string {
	return "## Done\nlanded it\n\n## Differs from plan\n" + differs + "\n\n## Not verified\n" + notVerified +
		"\n\n## For later tasks\n" + forLater + "\n\n## Found not fixed\n" + foundNotFixed + "\n"
}

// the record is what the workers reported, by task, whole: the lead's 2500-rune cap is for prompts, not this
func TestSealEvidenceRecordsTheDagsTasks(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "dag-record", "/p")
	if err != nil {
		t.Fatal(err)
	}
	ownerID, dagID := uuid.NewString(), uuid.NewString()
	w1, w2, w3, w4, w5 := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	long := strings.TrimSpace(strings.Repeat("é the timeout path has no test\n", 120))
	if n := len([]rune(long)); n <= 2500 {
		t.Fatalf("the fixture must run past the cap, it is %d runes", n)
	}
	workers := []waveobj.Run{
		{ID: w1, TaskId: "t-1", EndCommit: "c1", Evidence: &waveobj.RunEvidence{Summary: structuredReport("Put it in util/date.go.", long, "Call fmtDate, not Format.", "TestOld fails on main.")}},
		{ID: w2, TaskId: "t-2", EndCommit: "c2", Evidence: &waveobj.RunEvidence{Summary: "Added fmtDate and its tests.\nAll green."}},
		{ID: w3, TaskId: "t-3", Evidence: &waveobj.RunEvidence{Summary: structuredReport("None", "None", "None", "None")}},
		{ID: w4, TaskId: "t-4"},
		{ID: w5, TaskId: "t-5", EndCommit: "c5", Evidence: &waveobj.RunEvidence{Summary: structuredReport("None", "None", "Use the new helper.", "None")}},
	}
	for _, w := range workers {
		w.DagORef, w.Status = dagID, RunStatus_Done
		if err := wstore.AppendRun(ctx, ch.OID, w); err != nil {
			t.Fatal(err)
		}
	}
	g := &waveobj.TaskGroup{OID: dagID, RunID: ownerID, ChannelId: ch.OID, Tasks: []waveobj.TaskNode{
		{ID: "t-1", Label: "dates", State: "done", RunID: w1, ReviewRound: 1, ReviewUnverified: "no screenshot of the card"},
		{ID: "t-2", Label: "legacy", State: "skipped", RunID: w2, CleanupError: "worktree locked"},
		{ID: "t-3", Label: "broke", State: "failed", RunID: w3},
		{ID: "t-4", Label: "still going", State: "running", RunID: w4},
		{ID: "t-5", Label: "helper", State: "done", RunID: w5},
	}}
	g.ID = g.OID
	if err := wstore.AppendDag(ctx, g); err != nil {
		t.Fatal(err)
	}
	// the newest pass decides: t-1's last pass sent For later tasks to the lead, t-5's last one did not
	for _, ev := range []struct {
		kind   string
		detail map[string]any
	}{
		{waveobj.RunEventKindTaskReviewPassed, map[string]any{"taskid": "t-1", "forlead": false}},
		{waveobj.RunEventKindTaskReviewPassed, map[string]any{"taskid": "t-5", "forlead": true}},
		{waveobj.RunEventKindTaskReviewPassed, map[string]any{"taskid": "t-1", "forlead": true}},
		{waveobj.RunEventKindTaskReviewPassed, map[string]any{"taskid": "t-5", "forlead": false}},
		{waveobj.RunEventKindChildAnswered, nil},
		{waveobj.RunEventKindTaskForwarded, map[string]any{"taskid": "t-1"}},
		{waveobj.RunEventKindTaskTold, map[string]any{"taskid": "t-5", "text": "stop and commit"}},
	} {
		appendVerifyEvent(t, ch.OID, ownerID, ev.kind, ev.detail)
	}
	owner := &waveobj.Run{ID: ownerID, OID: ownerID, ChannelOID: ch.OID, DagORef: dagID, Status: RunStatus_Done, ProjectPath: t.TempDir(), CreatedTs: 1000}
	if err := SealEvidence(ctx, owner); err != nil {
		t.Fatal(err)
	}
	want := &waveobj.EvidenceDag{
		Tasks: []waveobj.EvidenceDagTask{
			{TaskId: "t-1", Label: "dates", State: "done", Commit: "c1", ReviewRounds: 1, Differs: "Put it in util/date.go.",
				NotVerified: long, ReviewerUnverified: "no screenshot of the card", FoundNotFixed: "TestOld fails on main.", ForLead: "Call fmtDate, not Format."},
			{TaskId: "t-2", Label: "legacy", State: "skipped", Commit: "c2", Unstructured: "Added fmtDate and its tests.\nAll green."},
			{TaskId: "t-3", Label: "broke", State: "failed"},
			{TaskId: "t-5", Label: "helper", State: "done", Commit: "c5"},
		},
		Answered:   1,
		Forwarded:  1,
		Told:       []string{"t-5: stop and commit"},
		LeftBehind: []string{"t-2"},
	}
	if !reflect.DeepEqual(owner.Evidence.Dag, want) {
		got, _ := json.MarshalIndent(owner.Evidence.Dag, "", "  ")
		t.Fatalf("dag record:\n%s", got)
	}
	if strings.Contains(string(mustJSON(t, owner.Evidence.Dag)), "landed it") {
		t.Fatalf("Done is never stored in the record")
	}

	child, err := wstore.GetRun(ctx, ch.OID, w1)
	if err != nil {
		t.Fatal(err)
	}
	child.Evidence = nil
	if err := SealEvidence(ctx, child); err != nil {
		t.Fatal(err)
	}
	if child.Evidence.Dag != nil {
		t.Fatalf("a worker's run carries no record, got %+v", child.Evidence.Dag)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// verificationCommands scans a transcript for Bash verification calls and pairs each with its result.
// Deduped by command (last result wins). Order preserved by first appearance.
func verificationCommands(lines []string) []waveobj.EvidenceVerif {
	acc := newVerifAccum()
	acc.addTranscript(lines)
	return acc.out
}
