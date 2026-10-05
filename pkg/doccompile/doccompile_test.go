// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package doccompile

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func writeFile(t *testing.T, path, body string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// sandbox returns a dir two levels inside the test's temp dir. FindTexRoot looks in the two dirs above a
// file, and the temp dir's own parents are the machine's %TEMP%, where an unrelated .tex file may sit.
func sandbox(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "w", "w")
}

const rootDoc = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n"

func sameFile(t *testing.T, got, want string) {
	t.Helper()
	if got == "" {
		t.Fatalf("root = %q, want %q", got, want)
	}
	if !strings.EqualFold(filepath.Clean(got), filepath.Clean(want)) {
		t.Fatalf("root = %q, want %q", got, want)
	}
}

func TestFindTexRoot(t *testing.T) {
	t.Run("magic comment resolves against the file's dir", func(t *testing.T) {
		dir := t.TempDir()
		main := writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "sections", "intro.tex"), "% !TEX root = ../main.tex\nSome prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, main)
	})
	t.Run("magic comment may omit the extension and the spacing", func(t *testing.T) {
		dir := t.TempDir()
		main := writeFile(t, filepath.Join(dir, "thesis.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "ch", "one.tex"), "%!TeX root=../thesis\nSome prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, main)
	})
	t.Run("magic comment is read only in the first 20 lines", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		body := strings.Repeat("prose\n", 20) + "% !TEX root = ../elsewhere.tex\n"
		sec := writeFile(t, filepath.Join(dir, "ch", "late.tex"), body)
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, filepath.Join(dir, "main.tex"))
	})
	t.Run("magic comment naming a missing file falls through", func(t *testing.T) {
		dir := t.TempDir()
		main := writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "ch", "one.tex"), "% !TEX root = ../gone.tex\nSome prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, main)
	})
	t.Run("the file itself when it has a documentclass", func(t *testing.T) {
		dir := t.TempDir()
		self := writeFile(t, filepath.Join(dir, "paper.tex"), "% header\n"+rootDoc)
		writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		got, err := FindTexRoot(self)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, self)
	})
	t.Run("a commented-out documentclass does not make a root", func(t *testing.T) {
		dir := t.TempDir()
		main := writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "ch", "one.tex"), "% \\documentclass{article}\nSome prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, main)
	})
	t.Run("main.tex two levels up is preferred over another root there", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, filepath.Join(dir, "abstract.tex"), rootDoc)
		main := writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		writeFile(t, filepath.Join(dir, "zeta.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "sections", "method", "overview.tex"), "Some prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, main)
	})
	t.Run("without a main.tex the first root by name wins", func(t *testing.T) {
		dir := t.TempDir()
		first := writeFile(t, filepath.Join(dir, "abstract.tex"), rootDoc)
		writeFile(t, filepath.Join(dir, "zeta.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "ch", "one.tex"), "Some prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, first)
	})
	t.Run("the nearer parent wins over the farther one", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		near := writeFile(t, filepath.Join(dir, "ch", "book.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "ch", "sub", "one.tex"), "Some prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		sameFile(t, got, near)
	})
	t.Run("a root three levels up is out of reach", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
		sec := writeFile(t, filepath.Join(dir, "a", "b", "c", "one.tex"), "Some prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		if got != "" {
			t.Fatalf("root = %q, want none", got)
		}
	})
	t.Run("no root gives an empty path and no error", func(t *testing.T) {
		dir := sandbox(t)
		sec := writeFile(t, filepath.Join(dir, "one.tex"), "Some prose.\n")
		writeFile(t, filepath.Join(dir, "two.tex"), "More prose.\n")
		got, err := FindTexRoot(sec)
		if err != nil {
			t.Fatal(err)
		}
		if got != "" {
			t.Fatalf("root = %q, want none", got)
		}
	})
	t.Run("a missing file is an error", func(t *testing.T) {
		if _, err := FindTexRoot(filepath.Join(t.TempDir(), "gone.tex")); err == nil {
			t.Fatal("want an error for a file that does not exist")
		}
	})
	t.Run("a file that is not .tex is an error", func(t *testing.T) {
		note := writeFile(t, filepath.Join(t.TempDir(), "note.md"), "# Note\n")
		if _, err := FindTexRoot(note); err == nil {
			t.Fatal("want an error for a .md file")
		}
	})
}

func TestPagesFromLog(t *testing.T) {
	cases := []struct {
		name, log string
		want      int
	}{
		{"pdfTeX", "Output written on main.pdf (8 pages, 123456 bytes).\nTranscript written on main.log.\n", 8},
		{"XeTeX xdv", "Output written on main.xdv (12 pages, 98765 bytes).\n", 12},
		{"one page", "Output written on main.pdf (1 page, 4321 bytes).\n", 1},
		{"no output line", "! Emergency stop.\nNo pages of output.\nTranscript written on main.log.\n", 0},
		{"empty", "", 0},
		{
			"wrapped at 79 columns after a long path",
			"Output written on C:\\Users\\alice\\AppData\\Local\\dev.arc.app\\data\\doccompile\\0123456789ab\\mai\nn.pdf (14 pages, 555 bytes).\nTranscript written on main.log.\n",
			14,
		},
		{
			"the last pass wins when a log holds several",
			"Output written on main.pdf (7 pages, 1 bytes).\nOutput written on main.pdf (8 pages, 2 bytes).\n",
			8,
		},
		{"CRLF line ends", "Output written on main.pdf (3 pages, 99 bytes).\r\nTranscript written on main.log.\r\n", 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := PagesFromLog(c.log); got != c.want {
				t.Fatalf("PagesFromLog = %d, want %d", got, c.want)
			}
		})
	}
}

const undefinedControlLog = `This is pdfTeX, Version 3.141592653-2.6-1.40.25 (TeX Live 2023) (preloaded format=pdflatex 2023.5.1)  5 OCT 2026 10:00
entering extended mode
 restricted \write18 enabled.
(./main.tex
LaTeX2e <2022-11-01> patch level 1
(/usr/share/texlive/texmf-dist/tex/latex/base/article.cls
Document Class: article 2022/07/02 v1.4n Standard LaTeX document class
(/usr/share/texlive/texmf-dist/tex/latex/base/size10.clo))
(./main.aux)
! Undefined control sequence.
l.12 The method uses \xyzdeterminism
                                    and then more.

?
! Emergency stop.
l.12 The method uses \xyzdeterminism
                                    and then more.

End of file on the terminal!

No pages of output.
Transcript written on main.log.
`

const missingStyleLog = `(./main.tex
LaTeX2e <2022-11-01> patch level 1
! LaTeX Error: File 'nopackage.sty' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)

Enter file name:
! Emergency stop.
<read *>

l.3 \usepackage{nopackage}

*** (job aborted, file error in nonstop mode)
`

func TestFirstErrorFromLog(t *testing.T) {
	t.Run("an undefined control sequence", func(t *testing.T) {
		want := "! Undefined control sequence.\nl.12 The method uses \\xyzdeterminism"
		if got := FirstErrorFromLog(undefinedControlLog); got != want {
			t.Fatalf("FirstErrorFromLog = %q, want %q", got, want)
		}
	})
	t.Run("the l. line may sit several lines after the error", func(t *testing.T) {
		want := "! LaTeX Error: File 'nopackage.sty' not found.\nl.3 \\usepackage{nopackage}"
		if got := FirstErrorFromLog(missingStyleLog); got != want {
			t.Fatalf("FirstErrorFromLog = %q, want %q", got, want)
		}
	})
	t.Run("an error with no l. line close by is just its own line", func(t *testing.T) {
		log := "! Emergency stop.\n" + strings.Repeat("filler\n", 30) + "l.99 far away\n"
		if got, want := FirstErrorFromLog(log), "! Emergency stop."; got != want {
			t.Fatalf("FirstErrorFromLog = %q, want %q", got, want)
		}
	})
	t.Run("CRLF line ends", func(t *testing.T) {
		log := strings.ReplaceAll(undefinedControlLog, "\n", "\r\n")
		want := "! Undefined control sequence.\nl.12 The method uses \\xyzdeterminism"
		if got := FirstErrorFromLog(log); got != want {
			t.Fatalf("FirstErrorFromLog = %q, want %q", got, want)
		}
	})
	t.Run("a clean log has none", func(t *testing.T) {
		if got := FirstErrorFromLog("Output written on main.pdf (1 page, 10 bytes).\n"); got != "" {
			t.Fatalf("FirstErrorFromLog = %q, want empty", got)
		}
	})
}

// fakes substitutes the engine runner, the PATH lookup and the data dir for one test and restores them.
type fakes struct {
	dataDir string
	engines map[string]bool // names lookPath finds
	run     func(ctx context.Context, c engineCmd) (string, error)
}

func useFakes(t *testing.T, f fakes) {
	t.Helper()
	oldRun, oldLook, oldData, oldTimeout := runEngine, lookPath, dataDir, compileTimeout
	t.Cleanup(func() { runEngine, lookPath, dataDir, compileTimeout = oldRun, oldLook, oldData, oldTimeout })
	if f.dataDir == "" {
		f.dataDir = t.TempDir()
	}
	dataDir = func() string { return f.dataDir }
	lookPath = func(name string) (string, error) {
		if f.engines[name] {
			return name, nil
		}
		return "", &exec.Error{Name: name, Err: exec.ErrNotFound}
	}
	runEngine = f.run
}

// waiters counts the requests parked on a compile somebody else started.
func waiters() int {
	mu.Lock()
	defer mu.Unlock()
	n := 0
	for _, f := range inflight {
		n += f.waiters
	}
	return n
}

// succeedingEngine writes the PDF and the log a real engine would, so Compile reads them back.
func succeedingEngine(pages string) func(ctx context.Context, c engineCmd) (string, error) {
	return func(ctx context.Context, c engineCmd) (string, error) {
		base := strings.TrimSuffix(c.RootFile, filepath.Ext(c.RootFile))
		if err := os.WriteFile(filepath.Join(c.OutDir, base+".pdf"), []byte("%PDF-1.5\n"), 0o644); err != nil {
			return "", err
		}
		log := "Output written on " + base + ".pdf (" + pages + " pages, 100 bytes).\nTranscript written on " + base + ".log.\n"
		if err := os.WriteFile(filepath.Join(c.OutDir, base+".log"), []byte(log), 0o644); err != nil {
			return "", err
		}
		return "engine stdout", nil
	}
}

func TestOutDir(t *testing.T) {
	data := t.TempDir()
	useFakes(t, fakes{dataDir: data})
	repo := t.TempDir()
	root := filepath.Join(repo, "paper", "main.tex")
	out := OutDir(root)

	if !strings.HasPrefix(out, filepath.Join(data, "doccompile")+string(filepath.Separator)) {
		t.Fatalf("OutDir = %q, want it under %q", out, filepath.Join(data, "doccompile"))
	}
	if rel, err := filepath.Rel(repo, out); err == nil && !strings.HasPrefix(rel, "..") {
		t.Fatalf("OutDir = %q is inside the repo %q", out, repo)
	}
	if strings.HasPrefix(out, filepath.Dir(root)) {
		t.Fatalf("OutDir = %q is inside the root's dir %q", out, filepath.Dir(root))
	}
	hash := filepath.Base(out)
	if len(hash) != 12 || strings.Trim(hash, "0123456789abcdef") != "" {
		t.Fatalf("OutDir leaf = %q, want 12 hex digits", hash)
	}
	if OutDir(root) != out {
		t.Fatal("OutDir is not stable for one root")
	}
	if OutDir(filepath.Join(repo, "paper", "other.tex")) == out {
		t.Fatal("two roots share an output dir")
	}
}

func TestCompileUsesLatexmkInTheRootsDir(t *testing.T) {
	dir := t.TempDir()
	root := writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
	sec := writeFile(t, filepath.Join(dir, "sections", "intro.tex"), "% !TEX root = ../main.tex\nProse.\n")
	var got engineCmd
	run := succeedingEngine("8")
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true, "tectonic": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			got = c
			return run(ctx, c)
		},
	})

	res, err := Compile(context.Background(), sec)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Ok || res.Engine != "latexmk" || res.Pages != 8 {
		t.Fatalf("result = %+v, want ok latexmk with 8 pages", res)
	}
	sameFile(t, res.RootPath, root)
	if want := filepath.Join(OutDir(res.RootPath), "main.pdf"); res.PdfPath != want {
		t.Fatalf("PdfPath = %q, want %q", res.PdfPath, want)
	}
	if res.DurationMs < 0 {
		t.Fatalf("DurationMs = %d", res.DurationMs)
	}
	if got.Name != "latexmk" || !strings.EqualFold(got.Dir, dir) {
		t.Fatalf("engine ran %q in %q, want latexmk in %q", got.Name, got.Dir, dir)
	}
	wantArgs := []string{"-pdf", "-interaction=nonstopmode", "-halt-on-error", "-outdir=" + OutDir(res.RootPath), "main.tex"}
	if strings.Join(got.Args, "\x00") != strings.Join(wantArgs, "\x00") {
		t.Fatalf("latexmk args = %q, want %q", got.Args, wantArgs)
	}
	if info, err := os.Stat(OutDir(res.RootPath)); err != nil || !info.IsDir() {
		t.Fatalf("the output dir was not created: %v", err)
	}
}

func TestCompileFallsBackToTectonic(t *testing.T) {
	dir := t.TempDir()
	main := writeFile(t, filepath.Join(dir, "main.tex"), rootDoc)
	var got engineCmd
	run := succeedingEngine("3")
	useFakes(t, fakes{
		engines: map[string]bool{"tectonic": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			got = c
			return run(ctx, c)
		},
	})

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Ok || res.Engine != "tectonic" || res.Pages != 3 {
		t.Fatalf("result = %+v, want ok tectonic with 3 pages", res)
	}
	wantArgs := []string{"--keep-logs", "--outdir", OutDir(res.RootPath), "main.tex"}
	if strings.Join(got.Args, "\x00") != strings.Join(wantArgs, "\x00") {
		t.Fatalf("tectonic args = %q, want %q", got.Args, wantArgs)
	}
}

func TestCompileWithNoEngine(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	var ran atomic.Int32
	useFakes(t, fakes{
		run: func(ctx context.Context, c engineCmd) (string, error) { ran.Add(1); return "", nil },
	})

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if res.Ok || res.Engine != "" || res.PdfPath != "" {
		t.Fatalf("result = %+v, want not ok, no engine, no pdf", res)
	}
	sameFile(t, res.RootPath, main)
	if ran.Load() != 0 {
		t.Fatal("an engine ran although none was found")
	}
}

func TestCompileWithNoRoot(t *testing.T) {
	sec := writeFile(t, filepath.Join(sandbox(t), "one.tex"), "Some prose.\n")
	var ran, looked atomic.Int32
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run:     func(ctx context.Context, c engineCmd) (string, error) { ran.Add(1); return "", nil },
	})
	inner := lookPath
	lookPath = func(name string) (string, error) { looked.Add(1); return inner(name) }

	res, err := Compile(context.Background(), sec)
	if err != nil {
		t.Fatal(err)
	}
	if res.RootPath != "" || res.Ok || res.Engine != "" {
		t.Fatalf("result = %+v, want an empty root, not ok, no engine", res)
	}
	if ran.Load() != 0 || looked.Load() != 0 {
		t.Fatalf("a root-less compile ran an engine %d times and looked for one %d times", ran.Load(), looked.Load())
	}
}

func TestCompileSharesOneRunPerRoot(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	started := make(chan struct{})
	release := make(chan struct{})
	var runs atomic.Int32
	inner := succeedingEngine("5")
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			if runs.Add(1) == 1 {
				close(started)
			}
			<-release
			return inner(ctx, c)
		},
	})

	var wg sync.WaitGroup
	results := make([]*Result, 2)
	errs := make([]error, 2)
	call := func(i int) {
		defer wg.Done()
		results[i], errs[i] = Compile(context.Background(), main)
	}
	wg.Add(1)
	go call(0)
	<-started
	wg.Add(1)
	go call(1)
	// Release the engine only once the second request is parked on the first's compile, so a late
	// arrival cannot start a compile of its own and fake a pass.
	deadline := time.Now().Add(5 * time.Second)
	for waiters() < 1 {
		if time.Now().After(deadline) {
			t.Fatal("the second request never joined the running compile")
		}
		time.Sleep(time.Millisecond)
	}
	close(release)
	wg.Wait()

	for i := range results {
		if errs[i] != nil {
			t.Fatalf("call %d: %v", i, errs[i])
		}
		if !results[i].Ok || results[i].Pages != 5 {
			t.Fatalf("call %d result = %+v, want ok with 5 pages", i, results[i])
		}
	}
	if *results[0] != *results[1] {
		t.Fatalf("the two requests got different results: %+v vs %+v", results[0], results[1])
	}
	if results[0] == results[1] {
		t.Fatal("the two requests share one Result pointer")
	}
	if n := runs.Load(); n != 1 {
		t.Fatalf("the engine ran %d times, want 1", n)
	}

	// Once it has finished, a later request compiles again (release is closed, so the engine returns at once).
	if _, err := Compile(context.Background(), main); err != nil {
		t.Fatal(err)
	}
	if n := runs.Load(); n != 2 {
		t.Fatalf("a request after the compile finished ran the engine %d times in all, want 2", n)
	}
}

func TestCompileDifferentRootsRunTogether(t *testing.T) {
	dir := t.TempDir()
	a := writeFile(t, filepath.Join(dir, "a", "main.tex"), rootDoc)
	b := writeFile(t, filepath.Join(dir, "b", "main.tex"), rootDoc)
	both := make(chan struct{})
	var inFlight atomic.Int32
	inner := succeedingEngine("1")
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			if inFlight.Add(1) == 2 {
				close(both)
			}
			select {
			case <-both:
			case <-time.After(5 * time.Second):
				return "", errors.New("the other root's compile never started: roots are serialised")
			}
			return inner(ctx, c)
		},
	})

	var wg sync.WaitGroup
	for _, p := range []string{a, b} {
		wg.Go(func() {
			res, err := Compile(context.Background(), p)
			if err != nil || !res.Ok {
				t.Errorf("Compile(%s) = %+v, %v", p, res, err)
			}
		})
	}
	wg.Wait()
}

func TestCompileReportsTheFirstError(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			if err := os.WriteFile(filepath.Join(c.OutDir, "main.log"), []byte(undefinedControlLog), 0o644); err != nil {
				return "", err
			}
			return "engine stdout", errors.New("exit status 12")
		},
	})

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if res.Ok || res.PdfPath != "" {
		t.Fatalf("result = %+v, want a failed compile with no pdf", res)
	}
	if want := "! Undefined control sequence.\nl.12 The method uses \\xyzdeterminism"; res.FirstError != want {
		t.Fatalf("FirstError = %q, want %q", res.FirstError, want)
	}
	if res.Engine != "latexmk" {
		t.Fatalf("Engine = %q, want latexmk", res.Engine)
	}
	if !strings.Contains(res.LogTail, "Transcript written on main.log.") {
		t.Fatalf("LogTail = %q, want the end of the log", res.LogTail)
	}
}

func TestCompileKeepsOnlyTheLogsLast40Lines(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	var lines []string
	for i := 1; i <= 100; i++ {
		lines = append(lines, "log line "+strings.Repeat("x", i%3)+string(rune('a'+i%26)))
	}
	lines[99] = "the very last line"
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			os.WriteFile(filepath.Join(c.OutDir, "main.log"), []byte(strings.Join(lines, "\n")+"\n"), 0o644)
			return "", errors.New("exit status 1")
		},
	})

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(res.LogTail, "\n")
	if len(got) != 40 {
		t.Fatalf("LogTail has %d lines, want 40", len(got))
	}
	if got[0] != lines[60] || got[39] != "the very last line" {
		t.Fatalf("LogTail runs %q .. %q, want lines 61 to 100", got[0], got[39])
	}
}

func TestCompileFallsBackToTheEngineOutputWithoutALog(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			return "Can't locate Foo.pm in @INC\nexecution of latexmk halted", errors.New("exit status 2")
		},
	})

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if res.Ok || !strings.Contains(res.LogTail, "execution of latexmk halted") {
		t.Fatalf("result = %+v, want a failure whose LogTail is the engine's output", res)
	}
}

func TestCompileStaleLogIsNotTrustedAfterAFailure(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			return "perl: command not found", errors.New("exit status 127")
		},
	})
	out := OutDir(main)
	stale := writeFile(t, filepath.Join(out, "main.log"), undefinedControlLog)
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if res.FirstError != "" || !strings.Contains(res.LogTail, "perl: command not found") {
		t.Fatalf("result = %+v, want the engine's own output, not last hour's log", res)
	}
}

func TestCompileOfAnUnchangedDocumentKeepsItsPageCount(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			return "Latexmk: All targets (main.pdf) are up-to-date", nil
		},
	})
	out := OutDir(main)
	// latexmk finds nothing to do: it exits 0 and leaves the PDF and the log of the earlier run in place.
	pdf := writeFile(t, filepath.Join(out, "main.pdf"), "%PDF-1.5\n")
	log := writeFile(t, filepath.Join(out, "main.log"), "Output written on main.pdf (6 pages, 100 bytes).\n")
	old := time.Now().Add(-time.Hour)
	for _, p := range []string{pdf, log} {
		if err := os.Chtimes(p, old, old); err != nil {
			t.Fatal(err)
		}
	}

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Ok || res.Pages != 6 {
		t.Fatalf("result = %+v, want ok with the earlier run's 6 pages", res)
	}
}

func TestCompileTimesOut(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			<-ctx.Done()
			return "partial output", ctx.Err()
		},
	})
	compileTimeout = 50 * time.Millisecond

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if res.Ok || res.PdfPath != "" {
		t.Fatalf("result = %+v, want a failed compile", res)
	}
	if !strings.Contains(res.LogTail, "timed out") {
		t.Fatalf("LogTail = %q, want it to say the compile timed out", res.LogTail)
	}
}

func TestCompileEngineThatCannotStart(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			return "", errors.New("fork/exec latexmk: access denied")
		},
	})

	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if res.Ok || res.Engine != "latexmk" || !strings.Contains(res.LogTail, "access denied") {
		t.Fatalf("result = %+v, want a failure that names the start error in LogTail", res)
	}
}

func TestCompileCallerCanLeaveWhileItWaits(t *testing.T) {
	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"), rootDoc)
	release := make(chan struct{})
	started := make(chan struct{})
	inner := succeedingEngine("1")
	useFakes(t, fakes{
		engines: map[string]bool{"latexmk": true},
		run: func(ctx context.Context, c engineCmd) (string, error) {
			close(started)
			<-release
			return inner(ctx, c)
		},
	})

	done := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _, err := Compile(ctx, main); done <- err }()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Compile after cancel = %v, want context.Canceled", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Compile did not return after its caller cancelled")
	}
	close(release)
}

// useRealEngine runs the next compile with the engine on PATH, writing into a temp data dir; it skips the test
// when no engine is installed.
func useRealEngine(t *testing.T) {
	t.Helper()
	_, haveLatexmk := exec.LookPath("latexmk")
	_, haveTectonic := exec.LookPath("tectonic")
	if haveLatexmk != nil && haveTectonic != nil {
		t.Skip("neither latexmk nor tectonic is on PATH")
	}
	// what a plan command runs under, Verify and the dev app Final starts alike: see engineEnv
	t.Setenv("MSYS_NO_PATHCONV", "1")
	old := dataDir
	data := t.TempDir()
	dataDir = func() string { return data }
	t.Cleanup(func() { dataDir = old })
}

func TestCompileRealDocument(t *testing.T) {
	useRealEngine(t)

	dir := t.TempDir()
	main := writeFile(t, filepath.Join(dir, "main.tex"), "\\documentclass{article}\n\\begin{document}\nHello, review.\n\\end{document}\n")
	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Ok {
		t.Fatalf("a minimal document did not compile with %q: first error %q\n%s", res.Engine, res.FirstError, res.LogTail)
	}
	if res.Engine != "latexmk" && res.Engine != "tectonic" {
		t.Fatalf("Engine = %q", res.Engine)
	}
	if res.Pages != 1 {
		t.Fatalf("Pages = %d, want 1\n%s", res.Pages, res.LogTail)
	}
	if want := filepath.Join(OutDir(res.RootPath), "main.pdf"); res.PdfPath != want {
		t.Fatalf("PdfPath = %q, want %q", res.PdfPath, want)
	}
	if b, err := os.ReadFile(res.PdfPath); err != nil || !strings.HasPrefix(string(b), "%PDF") {
		t.Fatalf("PdfPath is not a PDF: %v", err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("the compile left %d entries in the document's own dir, want only main.tex", len(entries))
	}
	if res.DurationMs <= 0 {
		t.Fatalf("DurationMs = %d, want a positive time", res.DurationMs)
	}
}

func TestCompileRealDocumentWithAnError(t *testing.T) {
	useRealEngine(t)

	main := writeFile(t, filepath.Join(t.TempDir(), "main.tex"),
		"\\documentclass{article}\n\\begin{document}\nHello \\xyzundefinedmacro review.\n\\end{document}\n")
	res, err := Compile(context.Background(), main)
	if err != nil {
		t.Fatal(err)
	}
	if res.Ok || res.PdfPath != "" {
		t.Fatalf("a document with an undefined macro compiled: %+v", res)
	}
	if !strings.HasPrefix(res.FirstError, "! Undefined control sequence.") || !strings.Contains(res.FirstError, "\nl.3 ") {
		t.Fatalf("FirstError = %q, want the undefined-control-sequence error and its l.3 line\n%s", res.FirstError, res.LogTail)
	}
}

func TestEngineEnvTurnsMsysPathConversionBackOn(t *testing.T) {
	env := []string{"PATH=C:\bin", "MSYS_NO_PATHCONV=1", "msys_no_pathconv=1", "MSYS_NO_PATHCONVERT=1"}
	got := engineEnv(env)
	want := []string{"PATH=C:\bin", "MSYS_NO_PATHCONVERT=1"}
	if !slices.Equal(got, want) {
		t.Fatalf("engineEnv = %q, want %q", got, want)
	}
	if len(env) != 4 {
		t.Fatalf("engineEnv changed its input: %q", env)
	}
}
