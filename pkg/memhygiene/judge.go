// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// a batch holds up to this many bytes of memory bodies, so one judge prompt stays a sane size
const judgeBatchBytes = 60 << 10

// the change kinds the judge may propose; the split's kinds come from code, not the model
const (
	judgeKindDelete     = "delete"
	judgeKindTrim       = "trim"
	judgeKindMerge      = "merge"
	judgeKindMoveToDoc  = "move-to-doc"
	judgeKindAddToIndex = "add-to-index"
)

const (
	judgeDocClaude = "CLAUDE.md"
	judgeDocAgents = "AGENTS.md"
	judgeIndexName = "MEMORY.md"
)

// the frontmatter keys the old memory harvester wrote
var judgeHarvesterKeys = []string{"source", "source_hash", "harvested_at"}

// Batches splits memories, in index order, into batches of at most judgeBatchBytes of bodies. A
// memory larger than that is a batch of its own.
func Batches(memories []Memory) [][]Memory {
	var out [][]Memory
	var cur []Memory
	size := 0
	for _, m := range memories {
		if len(cur) > 0 && size+len(m.Body) > judgeBatchBytes {
			out = append(out, cur)
			cur, size = nil, 0
		}
		cur = append(cur, m)
		size += len(m.Body)
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

// DocTarget is the instruction doc a move-to-doc change writes: the project's CLAUDE.md when it has
// one, else AGENTS.md (the file Claude Code loads when there's no CLAUDE.md).
func DocTarget(projectPath string) string {
	claude := filepath.Join(projectPath, judgeDocClaude)
	if st, err := os.Stat(claude); err == nil && st.Mode().IsRegular() {
		return claude
	}
	return filepath.Join(projectPath, judgeDocAgents)
}

// an index may state a budget of its own below Claude Code's limit, as "Budget: 12,000 bytes"
var judgeBudgetRe = regexp.MustCompile(`(?i)\bbudget:\s*([\d,]+)\s*bytes\b`)

// IndexBudget is the byte budget the index states outside its memory lines, else Claude Code's limit.
func IndexBudget(lines []string) int {
	for _, line := range lines {
		if len(IndexLinks(line)) > 0 {
			continue
		}
		if m := judgeBudgetRe.FindStringSubmatch(line); m != nil {
			n, err := strconv.Atoi(strings.ReplaceAll(m[1], ",", ""))
			if err == nil && n > 0 && n < LimitBytes {
				return n
			}
		}
	}
	return LimitBytes
}

// OverBudget reports whether the index is larger than its budget, which opens the hash gate.
func OverBudget(inv *Inventory) bool {
	return inv.Index.Bytes > IndexBudget(inv.IndexLines)
}

// judgeBudgetBrief tells the judge how far the index is over its budget and gives this batch its share
// of the cut, by the bytes its memories' index lines take; under budget it keeps the light touch.
func judgeBudgetBrief(inv *Inventory, batch []Memory, docName string) string {
	budget := IndexBudget(inv.IndexLines)
	over := inv.Index.Bytes - budget
	if over <= 0 {
		return fmt.Sprintf("The index is %d bytes of its %d-byte budget. Proposing nothing is a fine answer. Keep a rule whose index line does the work even if no session reads its file.", inv.Index.Bytes, budget)
	}
	total, mine := 0, 0
	for _, m := range inv.Memories {
		if m.IndexLine != "" {
			total += len(m.IndexLine) + 1
		}
	}
	for _, m := range batch {
		if m.IndexLine != "" {
			mine += len(m.IndexLine) + 1
		}
	}
	share := over
	if total > 0 {
		share = (over*mine + total - 1) / total
	}
	return fmt.Sprintf(`The index is %d bytes, %d over its %d-byte budget, and every session pays for each of its lines. The index lines of the memories below take %d bytes, so propose changes that cut at least %d bytes from the index. In order of preference: delete a memory that is stale, a one-off record, or repeats an instruction doc; merge memories that say one thing; shorten an index line longer than its hook needs (a trim whose "new" equals its "old", with the shorter "index_line"); move a rule the repo should own to %s. While the index is over budget, keep an index line only if a session would make a mistake without it.`, inv.Index.Bytes, over, budget, mine, share, docName)
}

// JudgePrompt asks the model for changes to one batch. It carries the whole index so the model knows
// what else exists, the batch's bodies with their evidence, and the instruction docs so it can spot a
// memory that repeats them. docTarget is the doc a move-to-doc change writes (DocTarget).
func JudgePrompt(inv *Inventory, batch []Memory, docs map[string]string, docTarget string) string {
	docName := filepath.Base(docTarget)
	var b strings.Builder
	b.WriteString(`You review a project's Claude Code auto memory. Sessions load the index, MEMORY.md, and read a topic file only when its index line looks relevant. Claude Code loads only the first ` + strconv.Itoa(LimitLines) + ` lines or ` + strconv.Itoa(LimitBytes) + ` bytes of the index, so the index must stay small and current.

Propose changes only where the evidence supports them. `)
	b.WriteString(judgeBudgetBrief(inv, batch, docName))
	b.WriteString(` A date's age alone is never a reason to change a memory: tell a one-off note (a past test result, a single verification) from a rule.

Change kinds:
- "delete": the memory is stale, wrong, a one-off record, or repeats an instruction doc. Deletes the file and its index line.
- "trim": replace one exact passage of a memory's body with a shorter one. "old" must be copied exactly from the body and appear in it once. Optionally "index_line" replaces the memory's index line.
- "merge": two or more memories of THIS batch say one thing. "merge_name" is the file written (one of the merged files, or a new kebab-case name ending in .md), "merge_body" its full content, "index_line" the one index line that replaces theirs. The other files are deleted.
- "move-to-doc": the memory is a rule the repo should own. "section" is the exact text of one heading in ` + docName + `, "passage" the markdown added at the end of that section. Deletes the memory and its index line.
- "add-to-index": a memory the index doesn't link that is still worth loading. "index_line" is its new index line.

An index line is one line: "- [short title](file-name.md) — the hook that tells a session when to read it". Every change acts on one memory, except merge.

Reply with strict JSON only, no prose, in this shape:
{"changes": [{"kind": "delete|trim|merge|move-to-doc|add-to-index", "title": "a short reason, for a table row", "files": ["memory-file.md"], "evidence": [{"tone": "ok|warn|none", "text": "one line of evidence", "code": "optional file, path or quote shown in monospace"}], "old": "", "new": "", "index_line": "", "merge_name": "", "merge_body": "", "section": "", "passage": ""}]}
Leave out the fields a kind doesn't use.

`)
	b.WriteString("## The whole index (MEMORY.md)\n\n")
	if len(inv.IndexLines) == 0 {
		b.WriteString("(no index)\n")
	}
	for _, line := range inv.IndexLines {
		b.WriteString(line + "\n")
	}
	if len(inv.DeadLinks) > 0 {
		b.WriteString("\nIndex links to files that don't exist: " + strings.Join(inv.DeadLinks, ", ") + "\n")
	}
	b.WriteString("\n## Memories to review\n")
	for _, m := range batch {
		b.WriteString("\n### " + m.Name + "\n\n")
		if m.IndexLine == "" {
			b.WriteString("Index line: none (the index doesn't link it)\n")
		} else {
			b.WriteString("Index line: " + m.IndexLine + "\n")
		}
		for _, key := range slices.Sorted(maps.Keys(m.Frontmatter)) {
			b.WriteString("Frontmatter " + key + ": " + m.Frontmatter[key] + "\n")
		}
		fmt.Fprintf(&b, "Read in %d of %d sessions\n", m.Reads, inv.Sessions)
		for _, ev := range m.Evidence {
			b.WriteString("Evidence: " + ev.Text + ev.Code + "\n")
		}
		b.WriteString("Body:\n" + m.Body + "\n")
	}
	b.WriteString("\n## Instruction docs\n")
	if _, ok := docs[docTarget]; !ok {
		b.WriteString("\nThe project has no " + docName + ", so propose no move-to-doc.\n")
	}
	for _, path := range slices.Sorted(maps.Keys(docs)) {
		b.WriteString("\n### " + path + "\n\n" + docs[path] + "\n")
	}
	return b.String()
}

// SortPrompt asks which registered projects each memory of a shared folder applies to, over each
// memory's index line and description only.
func SortPrompt(shared *Inventory, projects []string) string {
	var b strings.Builder
	b.WriteString(`Several projects in one git repo share this Claude Code auto memory folder. Sort each memory by the projects it applies to.

Projects: ` + strings.Join(projects, ", ") + `
Use "other" for a memory about a part of the repo that isn't one of these projects. A memory can apply to several projects, and to "other" as well.

Reply with strict JSON only, no prose, in this shape:
{"sort": {"memory-file.md": ["project", "other"]}}
List every memory below.

## Memories
`)
	for _, m := range shared.Memories {
		b.WriteString("\n" + m.Name + "\n")
		if m.IndexLine != "" {
			b.WriteString("Index line: " + m.IndexLine + "\n")
		}
		if m.Description != "" {
			b.WriteString("Description: " + m.Description + "\n")
		}
	}
	return b.String()
}

// ParseSort reads SortPrompt's reply: memory name to the registered projects and/or "other" it
// applies to.
func ParseSort(reply string) (map[string][]string, error) {
	var sorted map[string][]string
	if err := judgeExtract(reply, "sort", &sorted); err != nil {
		return nil, fmt.Errorf("memory hygiene sort reply: %w", err)
	}
	return sorted, nil
}

type judgeChange struct {
	Kind      string               `json:"kind"`
	Title     string               `json:"title"`
	Files     []string             `json:"files"`
	Evidence  []wshrpc.MemEvidence `json:"evidence"`
	Old       string               `json:"old"`
	New       string               `json:"new"`
	IndexLine string               `json:"index_line"`
	MergeName string               `json:"merge_name"`
	MergeBody string               `json:"merge_body"`
	Section   string               `json:"section"`
	Passage   string               `json:"passage"`
}

// ParseJudge reads JudgePrompt's reply into full changes, with each touched file's hash as it is now.
// A reply with no complete JSON object (malformed or truncated) is an error, so the caller keeps the
// last good result.
func ParseJudge(reply string, inv *Inventory, docTarget string) ([]wshrpc.MemChange, error) {
	var raw []judgeChange
	if err := judgeExtract(reply, "changes", &raw); err != nil {
		return nil, fmt.Errorf("memory hygiene judge reply: %w", err)
	}
	index, err := ReadText(inv.IndexPath)
	if err != nil {
		return nil, err
	}
	var out []wshrpc.MemChange
	for i, jc := range raw {
		change, err := judgeBuild(jc, inv, docTarget, len(index.EOL))
		if err != nil {
			return nil, fmt.Errorf("memory hygiene judge reply, change %d (%q): %w", i+1, jc.Title, err)
		}
		out = append(out, change)
	}
	return out, nil
}

// judgeExtract decodes key's value from the first JSON object in reply that has key. Scanning every
// '{' tolerates prose and a fenced block around the object; a truncated object never decodes.
func judgeExtract(reply, key string, v any) error {
	for i := strings.IndexByte(reply, '{'); i >= 0; {
		var obj map[string]json.RawMessage
		if json.NewDecoder(strings.NewReader(reply[i:])).Decode(&obj) == nil {
			if raw, ok := obj[key]; ok {
				if err := json.Unmarshal(raw, v); err != nil {
					return fmt.Errorf("%q is malformed: %w", key, err)
				}
				return nil
			}
		}
		next := strings.IndexByte(reply[i+1:], '{')
		if next < 0 {
			break
		}
		i += 1 + next
	}
	return fmt.Errorf("no complete JSON object with %q in %d bytes (malformed or truncated)", key, len(reply))
}

func judgeBuild(jc judgeChange, inv *Inventory, docTarget string, eolLen int) (wshrpc.MemChange, error) {
	byName := map[string]*Memory{}
	for i := range inv.Memories {
		byName[inv.Memories[i].Name] = &inv.Memories[i]
	}
	op := wshrpc.MemOp{Folder: inv.Folder, Memories: jc.Files}
	removesIndex := true
	switch jc.Kind {
	case judgeKindDelete:
	case judgeKindTrim:
		op.Old, op.New, op.IndexAdd = jc.Old, jc.New, jc.IndexLine
		removesIndex = jc.IndexLine != ""
	case judgeKindMerge:
		op.WriteName, op.WriteBody, op.IndexAdd = jc.MergeName, jc.MergeBody, jc.IndexLine
		if op.WriteName == "" && len(jc.Files) > 0 {
			op.WriteName = jc.Files[0]
		}
	case judgeKindMoveToDoc:
		op.DocPath, op.DocSection, op.DocPassage = docTarget, jc.Section, jc.Passage
	case judgeKindAddToIndex:
		op.IndexAdd = jc.IndexLine
		removesIndex = false
		for _, name := range jc.Files {
			if m := byName[name]; m != nil {
				op.StripHarvester = op.StripHarvester || judgeHasHarvester(m)
			}
		}
	default:
		return wshrpc.MemChange{}, fmt.Errorf("unknown change kind %q", jc.Kind)
	}
	if removesIndex {
		for _, name := range jc.Files {
			if m := byName[name]; m != nil && m.IndexLine != "" && !slices.Contains(op.IndexRemove, m.IndexLine) {
				op.IndexRemove = append(op.IndexRemove, m.IndexLine)
			}
		}
	}

	// the index and the instruction doc stay out of Files, as for a split: the index edit is exact-line
	// and the doc edit appends to a named section, so applying one change must not turn every sibling's
	// hash check into a conflict. apply checks each edit itself.
	var paths []string
	for _, name := range jc.Files {
		paths = append(paths, filepath.Join(inv.Folder, name))
	}
	if op.WriteName != "" {
		paths = append(paths, filepath.Join(inv.Folder, op.WriteName))
	}
	var files []wshrpc.MemFileRef
	for _, p := range paths {
		if slices.ContainsFunc(files, func(f wshrpc.MemFileRef) bool { return f.Path == p }) {
			continue
		}
		hash, err := HashFile(p)
		if err != nil {
			return wshrpc.MemChange{}, err
		}
		files = append(files, wshrpc.MemFileRef{Path: p, Sha256: hash})
	}

	delta := judgeIndexDelta(op, eolLen)
	return wshrpc.MemChange{
		Id:         ChangeID(jc.Kind, files),
		Kind:       jc.Kind,
		Title:      jc.Title,
		Note:       judgeNote(jc.Kind, op),
		ApplyLabel: judgeApplyLabel(jc.Kind, docTarget),
		Effect:     judgeEffect(jc.Kind, op, delta, byName),
		Files:      files,
		Evidence:   judgeEvidence(jc.Evidence),
		Diffs:      judgeDiffs(jc.Kind, op, byName),
		IndexDelta: delta,
		Op:         op,
		Status:     "open",
	}, nil
}

func judgeIndexDelta(op wshrpc.MemOp, eolLen int) wshrpc.MemIndexDelta {
	var d wshrpc.MemIndexDelta
	for _, line := range op.IndexRemove {
		d.Lines--
		d.Bytes -= len(line) + eolLen
	}
	if op.IndexAdd != "" {
		d.Lines++
		d.Bytes += len(op.IndexAdd) + eolLen
	}
	return d
}

func judgeApplyLabel(kind, docTarget string) string {
	switch kind {
	case judgeKindDelete:
		return "Delete memory"
	case judgeKindTrim:
		return "Apply trim"
	case judgeKindMerge:
		return "Merge entries"
	case judgeKindMoveToDoc:
		return "Move to " + filepath.Base(docTarget)
	default:
		return "Add to index"
	}
}

func judgeNote(kind string, op wshrpc.MemOp) string {
	switch {
	case kind == judgeKindMoveToDoc:
		return "Leaves " + filepath.Base(op.DocPath) + " changed in your working tree. Commit it with your next change."
	case kind == judgeKindTrim && op.IndexAdd == "":
		return "The index line stays as it is."
	case kind == judgeKindMerge:
		return "The bodies are joined into " + op.WriteName + "; the other files are deleted."
	case kind == judgeKindAddToIndex && op.StripHarvester:
		return "The old harvester’s fields are dropped from a memory it keeps."
	}
	return ""
}

// judgeEffect is the table cell: the index's change when there is one, else the body's or the files'.
func judgeEffect(kind string, op wshrpc.MemOp, delta wshrpc.MemIndexDelta, byName map[string]*Memory) string {
	if delta.Bytes != 0 {
		return "Index " + judgeSignedBytes(delta.Bytes)
	}
	switch kind {
	case judgeKindTrim:
		return "Body " + judgeSignedBytes(len(op.New)-len(op.Old))
	case judgeKindDelete, judgeKindMerge, judgeKindMoveToDoc:
		removed := 0
		for _, name := range op.Memories {
			if m := byName[name]; m != nil {
				removed += m.Size
			}
		}
		if kind == judgeKindMerge {
			removed -= len(op.WriteBody)
		}
		return "File " + judgeSignedBytes(-removed)
	}
	return ""
}

func judgeDiffs(kind string, op wshrpc.MemOp, byName map[string]*Memory) []wshrpc.MemDiff {
	var diffs []wshrpc.MemDiff
	if kind == judgeKindMoveToDoc {
		diffs = append(diffs, wshrpc.MemDiff{Path: filepath.Base(op.DocPath), Note: op.DocSection, Lines: judgeDiffLines("+", op.DocPassage)})
	}
	if len(op.IndexRemove) > 0 || op.IndexAdd != "" {
		var lines []wshrpc.MemDiffLine
		for _, l := range op.IndexRemove {
			lines = append(lines, wshrpc.MemDiffLine{Sign: "-", Text: l})
		}
		added := 0
		if op.IndexAdd != "" {
			added = 1
			lines = append(lines, wshrpc.MemDiffLine{Sign: "+", Text: op.IndexAdd})
		}
		diffs = append(diffs, wshrpc.MemDiff{Path: judgeIndexName, Note: judgeLinesNote(len(op.IndexRemove), added), Lines: lines})
	}
	switch kind {
	case judgeKindTrim:
		lines := append(judgeDiffLines("-", op.Old), judgeDiffLines("+", op.New)...)
		diffs = append(diffs, wshrpc.MemDiff{Path: judgeFirst(op.Memories), Note: "body", Lines: lines})
	case judgeKindMerge:
		diffs = append(diffs, wshrpc.MemDiff{Path: op.WriteName, Note: "written · " + judgeBytes(len(op.WriteBody)), Lines: judgeDiffLines("+", op.WriteBody)})
		for _, name := range op.Memories {
			if name != op.WriteName {
				diffs = append(diffs, judgeDeletedDiff(name, byName[name], false))
			}
		}
	case judgeKindDelete, judgeKindMoveToDoc:
		for _, name := range op.Memories {
			diffs = append(diffs, judgeDeletedDiff(name, byName[name], kind == judgeKindDelete))
		}
	case judgeKindAddToIndex:
		if !op.StripHarvester {
			break
		}
		for _, name := range op.Memories {
			m := byName[name]
			if m == nil {
				continue
			}
			var lines []wshrpc.MemDiffLine
			for _, key := range judgeHarvesterKeys {
				if v, ok := m.Frontmatter[key]; ok {
					lines = append(lines, wshrpc.MemDiffLine{Sign: "-", Text: key + ": " + v})
				}
			}
			diffs = append(diffs, wshrpc.MemDiff{Path: name, Note: "frontmatter", Lines: lines})
		}
	}
	return diffs
}

// judgeDeletedDiff shows a deleted file; the body only for a plain delete, where nothing else shows it.
func judgeDeletedDiff(name string, m *Memory, withBody bool) wshrpc.MemDiff {
	d := wshrpc.MemDiff{Path: name, Note: "deleted"}
	if m != nil {
		d.Note = "deleted · " + judgeBytes(m.Size)
		if withBody {
			d.Lines = judgeDiffLines("-", m.Body)
		}
	}
	return d
}

func judgeDiffLines(sign, text string) []wshrpc.MemDiffLine {
	text = strings.TrimRight(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if text == "" {
		return nil
	}
	var out []wshrpc.MemDiffLine
	for _, line := range strings.Split(text, "\n") {
		out = append(out, wshrpc.MemDiffLine{Sign: sign, Text: line})
	}
	return out
}

func judgeLinesNote(removed, added int) string {
	switch {
	case removed > 0 && added > 0:
		return judgeLineCount(removed) + " → " + strconv.Itoa(added)
	case removed > 0:
		return "−" + judgeLineCount(removed)
	default:
		return "+" + judgeLineCount(added)
	}
}

func judgeLineCount(n int) string {
	if n == 1 {
		return "1 line"
	}
	return strconv.Itoa(n) + " lines"
}

// judgeEvidence keeps the judge's evidence lines, with an unknown tone read as none.
func judgeEvidence(in []wshrpc.MemEvidence) []wshrpc.MemEvidence {
	out := make([]wshrpc.MemEvidence, 0, len(in))
	for _, ev := range in {
		if ev.Tone != "ok" && ev.Tone != "warn" {
			ev.Tone = "none"
		}
		out = append(out, ev)
	}
	return out
}

// judgeSignedBytes formats a byte delta the way the table shows it ("−1,216 B", "+130 B").
func judgeSignedBytes(n int) string {
	switch {
	case n < 0:
		return "−" + judgeBytes(-n)
	case n > 0:
		return "+" + judgeBytes(n)
	}
	return judgeBytes(0)
}

func judgeBytes(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s + " B"
}

func judgeHasHarvester(m *Memory) bool {
	for _, key := range judgeHarvesterKeys {
		if _, ok := m.Frontmatter[key]; ok {
			return true
		}
	}
	return false
}

func judgeFirst(list []string) string {
	if len(list) == 0 {
		return ""
	}
	return list[0]
}
