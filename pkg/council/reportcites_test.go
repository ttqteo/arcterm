// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// auditDoc is cut from the council of 2026-11-04 (mit-thesis, docs/council/2026-11-04-chốt-bài-toán-…md): a direction
// whose coordinator prose cites four places, a proposal whose Evidence line cites a report of the council before it, a
// cite of a memory file outside the project, and an Also raised line that cites nothing. The cited files are rebuilt in
// a temp project from the lines the real ones hold there.
const auditDoc = `# Council: Chốt bài toán và hướng đi tiếp cho harnesspov (solo)

You asked: không có gì để kiểm ở đây, kể cả CLAUDE.md:1.

**Bài toán: không có bản vá, harness cộng gì so với lấy mẫu lặp cùng token.**

## Directions

1. **Patch M5 to the full 60 cases, save PoV code, and report negatives only at their real power** (Agreed)
   From P24 (Methodologist), P6 (Reviewer 1 (area expert)).
   The committed curve.json reports n_paired = 0 while still printing a verdict (harnesspov/results/m5curve/curve.json:12). Best-of-k covers only 33 of 60 cases, 26 SecBench vs 7 PoCGen (harnesspov/results/m5curve/test_cases.json:237). The scorer counts a case as won if any run passes tier 2, so M5 compares one ceiling against another (harnesspov/harnesspov/agent/budget_curve.py:900). Merged in: the adaptive loop and the M3 gaps sit inside the PREREG noise floor of ±3 cases (harnesspov/results/m5curve/PREREG.md:39).
   First step: Change the best-of-k shard writer to save each run's PoV code; at 16:51 fire a pilot (r73).

## Also raised

- **Schedule to registration with a stop gate per milestone** (from P19 (Planner)): Patch M5 in early November, see https://example.org/plan.html:80 for the calendar.

## Matrix

| Proposal | Methodologist | Outcome |
|---|---|---|
| P1 · cites harnesspov/results/m5curve/curve.json:999 in a cell (Read code) | accept: | Also raised |

## The discussion

- **Related work** proposes · P1 · Chốt một câu đóng góp ở chỗ chọn PoV
  Best-of-k mới chạy 33 trên 60 ca, nên X phải tính trên số ca đã đo. Bảng so tối thiểu dùng gom theo hành vi như AlphaCode clustering.
  Evidence: docs/council/2026-11-02-harnessx-harness-foundry-meta-agent-đọc-vết-rồi-sinh-harness.md:341; obsidian_harness/missing.html:3
  Check: Read code
- **Related work** proposes · P5 · Câu hỏi cho thầy
  Thầy muốn tập trung harness, theo hồ sơ thầy hướng dẫn.
  Evidence: C:\Users\someone\.claude\projects\x\memory\reference_advisor_profile.md:18 (wrong cite: path is outside the folders this council reads)
- **Planner** agrees · on P1 · Chốt một câu đóng góp ở chỗ chọn PoV
  Check: Guess

## Run facts

- Experts: Methodologist (sonnet), Related work (sonnet)
- Harness: 2026-11-04.1 (see CLAUDE.md:2)
`

// auditProject writes the files auditDoc cites, with the lines the real ones hold where it cites them.
func auditProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	write := func(rel string, lines map[int]string, total int) {
		var b strings.Builder
		for i := 1; i <= total; i++ {
			b.WriteString(lines[i] + "\n")
		}
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(b.String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("harnesspov/results/m5curve/curve.json", map[int]string{11: `  "budgets": [1, 2, 4, 8],`, 12: `  "n_paired": 0,`}, 80)
	write("harnesspov/results/m5curve/test_cases.json", map[int]string{235: `   "entry_id": "CVE-2020-28441",`,
		236: `   "class": "proto",`, 237: `   "source": "pocgen",`, 238: `   "package": "conf-cfg-ini",`}, 300)
	write("harnesspov/harnesspov/agent/budget_curve.py", map[int]string{47: `    tier1 = passed or row.get("tier") == "tier2"`}, 60)
	write("harnesspov/results/m5curve/PREREG.md", map[int]string{39: `- Noise floor: a gap of 3 cases or fewer is noise.`}, 50)
	write("docs/council/2026-11-02-harnessx-harness-foundry-meta-agent-đọc-vết-rồi-sinh-harness.md", map[int]string{
		338: `  | Bộ chọn PoV lấp độ hở | đo được, 0-3 USD | nhỏ mà thật |`,
		341: `  Evidence: harnesspov/results/m5curve/curve.json`}, 360)
	write("CLAUDE.md", map[int]string{1: "# CLAUDE.md"}, 5)
	return root
}

func auditByRef(a CiteAudit) map[string]ReportCite {
	out := map[string]ReportCite{}
	for _, c := range a.Cites {
		out[c.Ref] = c
	}
	return out
}

func TestAuditReportCitesReadsEveryCiteOfTheReport(t *testing.T) {
	root := auditProject(t)
	got := auditByRef(AuditReportCites(auditDoc, []string{root}))
	for ref, want := range map[string]string{
		// the coordinator's prose: an identifier of the sentence is on the line
		"harnesspov/results/m5curve/curve.json:12": CiteHolds,
		"harnesspov/results/m5curve/PREREG.md:39":  CiteHolds,
		// "pocgen" is on the line; in the whole report of 04/11 it is in too many items to count and this cite is a no match
		"harnesspov/results/m5curve/test_cases.json:237": CiteHolds,
		// past the end of a 60-line file
		"harnesspov/harnesspov/agent/budget_curve.py:900": CiteBroken,
		// an Evidence line is all refs: its message is read, and line 341 of the old report is another Evidence line
		"docs/council/2026-11-02-harnessx-harness-foundry-meta-agent-đọc-vết-rồi-sinh-harness.md:341": CiteNoMatch,
		"obsidian_harness/missing.html:3":                                            CiteBroken,
		`C:\Users\someone\.claude\projects\x\memory\reference_advisor_profile.md:18`: CiteOutside,
	} {
		c, ok := got[ref]
		if !ok {
			t.Errorf("%s was not found in the report", ref)
			continue
		}
		if c.Verdict != want {
			t.Errorf("%s: verdict %q (%s), want %q", ref, c.Verdict, c.Note, want)
		}
	}
	// the person's question, the matrix's cut cells, the run facts, a URL, a clock time and a reply id are not cites
	for _, ref := range []string{"CLAUDE.md:1", "CLAUDE.md:2", "harnesspov/results/m5curve/curve.json:999", "plan.html:80",
		"example.org/plan.html:80"} {
		if _, ok := got[ref]; ok {
			t.Errorf("%s was read as a cite of the report", ref)
		}
	}
	if len(got) != 7 {
		t.Errorf("found %d places, want 7: %v", len(got), got)
	}
}

func TestAuditReportCitesSaysWhyAndWhere(t *testing.T) {
	root := auditProject(t)
	got := auditByRef(AuditReportCites(auditDoc, []string{root}))
	if c := got["harnesspov/harnesspov/agent/budget_curve.py:900"]; c.Note != "line 900 is past the end (60 lines)" {
		t.Errorf("note = %q", c.Note)
	}
	if c := got["obsidian_harness/missing.html:3"]; c.Note != "file not found" || c.Where[0] != "Related work proposes · P1" {
		t.Errorf("missing file: %+v", c)
	}
	if c := got["harnesspov/results/m5curve/curve.json:12"]; c.Where[0] != "Directions" || len(c.Keywords) == 0 || c.Keywords[0] != "n_paired" {
		t.Errorf("curve.json:12: %+v", c)
	}
	if c := got["docs/council/2026-11-02-harnessx-harness-foundry-meta-agent-đọc-vết-rồi-sinh-harness.md:341"]; !strings.HasPrefix(c.Note, "looked for ") || !strings.HasSuffix(c.Note, "near line 341") {
		t.Errorf("no-match note = %q", c.Note)
	}
}

func TestAuditReportCitesCountsAPlaceOnceAndEachTimeItIsCited(t *testing.T) {
	root := auditProject(t)
	doc := "## Directions\n\n1. **A** n_paired is zero (harnesspov/results/m5curve/curve.json:12).\n" +
		"2. **B** again the n_paired count (harnesspov/results/m5curve/curve.json:12; harnesspov/results/m5curve/curve.json:L12).\n"
	a := AuditReportCites(doc, []string{root})
	if len(a.Cites) != 1 || a.Times() != 3 || a.Count(CiteHolds) != 1 {
		t.Fatalf("audit = %+v, want one place cited three times", a)
	}
}

// a word of the report's topic is near every line of the project: finding it proves nothing about the cite
func TestAuditReportCitesIgnoresTheTopicsOwnWords(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "notes.md"), []byte("harness harness harness\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	b.WriteString("## Also raised\n\n")
	for range 12 {
		b.WriteString("- **Idea** the harness wins somewhere\n")
	}
	b.WriteString("- **Claim** the harness beats sampling on proto cases (notes.md:1)\n")
	got := auditByRef(AuditReportCites(b.String(), []string{root}))
	if c := got["notes.md:1"]; c.Verdict != CiteNoMatch {
		t.Errorf("notes.md:1 = %+v, want no match: harness is the topic", c)
	}
}

func TestCiteCheckSectionTalliesAndLists(t *testing.T) {
	root := auditProject(t)
	s := CiteCheckSection(auditDoc, []string{root})
	for _, want := range []string{
		"## Cite check\n",
		"7 places, cited 7 times. 3 hold",
		"1 have no such keyword near the line, 2 are wrong, 1 are outside",
		"Wrong:\n\n- `harnesspov/harnesspov/agent/budget_curve.py:900` (Directions): line 900 is past the end (60 lines)",
		"No keyword near the line (read these by hand):",
		"Outside the council's folders (not checked):",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("section lacks %q:\n%s", want, s)
		}
	}
	if CiteCheckSection("## Directions\n\n1. **A** nothing cited\n", []string{root}) != "" {
		t.Error("a report that cites nothing got a section")
	}
}

// the saved document carries the section between the matrix and the discussion; Document, which reads no file, does not
func TestWriteDocumentChecksItsCites(t *testing.T) {
	useDocDay(t)
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "a.go"), []byte("package a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := docCouncil(project) // P1 cites a.go:1 (there), P2 cites b.go:2 (not there)
	path, err := WriteDocument(c, "")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	doc := string(data)
	check, disc := strings.Index(doc, "## Cite check\n"), strings.Index(doc, "## The discussion\n")
	if check < 0 || disc < 0 || check > disc {
		t.Fatalf("the cite check is not before the discussion:\n%s", doc)
	}
	if !strings.Contains(doc, "- `b.go:2` (RAM proposes · P2): file not found") {
		t.Errorf("the wrong cite is not listed:\n%s", doc[check:disc])
	}
	if strings.Contains(Document(c), "## Cite check") {
		t.Error("Document read the files")
	}
}
