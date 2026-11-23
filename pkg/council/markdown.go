// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
)

const matrixReasonRunes = 120 // a matrix cell keeps one line of the reason, cut here

// A saved report is two files. The main file (reportMain) holds what is about the person's project, in the language of
// their question: the feature, the question, the direction they chose, the answer, a to-do table with one row per
// direction, a table of the figures Go checked against the project's files, what the council settled (Agreed, Ruled out,
// Open), the message they pinned as the Final proposal, and a line that links the side file. The side file
// (reportSide, `<name>.discussion.md`) holds everything about how the council got there, with English headings: the
// at-a-glance chart, each direction in full, the matrix, the figures that did not check out, the cite check, the whole
// discussion and the run facts. Document is both, one after the other; WriteDocument writes each to its own file.

// Markdown is the report as an agent reads it, what `wsh council wait` and `show` print: the main file's content with
// no link to a side file (the feature, the question, the direction the person chose with the ones it replaced, the
// question's one-sentence answer, the coordinator's paragraph, the to-do and figures tables, the memory's entries),
// then the detail an agent acts on that the saved report keeps in its side file: the directions in rank order (a
// Brainstorm's ideas worth trying) each with its reasoning, first step and each expert's stance, one line each for a
// Brainstorm's wild ideas kept aside or a Review's directions also raised, the questions to ask next, then proposals ×
// experts, and last the message the person pinned as the Final proposal, while one is pinned.
func Markdown(c *Council) string {
	w := wordsOf(c)
	parts := mainParts(c, w)
	parts = append(parts, detailParts(c)...)
	return joinParts(append(parts, finalProposalPart(c, w))...)
}

// sect runs write on a fresh builder and gives what it wrote, its trailing newlines cut.
func sect(write func(b *strings.Builder)) string {
	var b strings.Builder
	write(&b)
	return strings.TrimRight(b.String(), "\n")
}

// joinParts is the parts that hold something as one document: a blank line between two, one newline at the end, and
// nothing at all when no part holds anything.
func joinParts(parts ...string) string {
	var keep []string
	for _, p := range parts {
		if p = strings.TrimRight(p, "\n"); p != "" {
			keep = append(keep, p)
		}
	}
	if len(keep) == 0 {
		return ""
	}
	return strings.Join(keep, "\n\n") + "\n"
}

// mainParts are the sections the main file and Markdown share, in order: the title, the question, the direction the
// person chose, the answer with the coordinator's paragraph, the to-do table, the figures table and the memory's entries.
func mainParts(c *Council, w reportWords) []string {
	parts := []string{"# " + w.title + c.Feature}
	if q := oneLine(c.Question); q != "" {
		parts = append(parts, w.asked+q)
	}
	return append(parts, memoryDirectionPart(c, w), answerPart(c, w), todoPart(c, w), figuresPart(c, w), memoryEntriesPart(c, w))
}

// answerPart is the question's one-sentence answer in bold, then the coordinator's paragraph; the note that there is no
// summary yet while the council has none.
func answerPart(c *Council, w reportWords) string {
	if c.Summary == nil {
		return w.noSummary
	}
	var parts []string
	if a := oneLine(c.Summary.Answer); a != "" {
		parts = append(parts, "**"+a+"**")
	}
	if t := strings.TrimSpace(c.Summary.Text); t != "" {
		parts = append(parts, t)
	}
	return strings.Join(parts, "\n\n")
}

// detailParts are the sections of detail an agent acts on, in order: the directions in full, the kept ones, the
// questions to ask next and the matrix. The side file holds them (after its at-a-glance chart) and Markdown prints them.
func detailParts(c *Council) []string {
	var parts []string
	if c.Summary != nil {
		parts = append(parts, directionsPart(c), keptPart(c), asksPart(c))
	}
	if len(sentProposals(c)) > 0 {
		parts = append(parts, sect(func(b *strings.Builder) {
			b.WriteString("## Matrix\n\n")
			writeMatrix(b, c)
		}))
	}
	return parts
}

// directionsPart is the directions in rank order, each in full: a Review's "Directions", a Brainstorm's "Ideas worth
// trying".
func directionsPart(c *Council) string {
	if len(c.Summary.Directions) == 0 {
		return ""
	}
	return sect(func(b *strings.Builder) {
		if isBrainstorm(c) {
			b.WriteString("## Ideas worth trying\n\n")
		} else {
			b.WriteString("## Directions\n\n")
		}
		for i, d := range c.Summary.Directions {
			writeDirection(b, c, i+1, d)
		}
	})
}

// keptPart is a Brainstorm's wild ideas kept aside, or a Review's directions also raised, a line each.
func keptPart(c *Council) string {
	if len(c.Summary.Kept) == 0 {
		return ""
	}
	return sect(func(b *strings.Builder) {
		if isBrainstorm(c) {
			b.WriteString("## Wild ideas kept aside\n\n")
		} else {
			b.WriteString("## Also raised\n\n")
		}
		for _, d := range c.Summary.Kept {
			writeKept(b, c, d)
		}
	})
}

// asksPart is the questions to ask the panel next.
func asksPart(c *Council) string {
	if len(c.Summary.Asks) == 0 {
		return ""
	}
	return sect(func(b *strings.Builder) {
		b.WriteString("## Ask next\n\n")
		for _, a := range c.Summary.Asks {
			fmt.Fprintf(b, "- %s: %s\n", askedOf(c, a), oneLine(a.Text))
		}
	})
}

// cellOr is a table cell's text, or "—" when it holds nothing.
func cellOr(s string) string {
	if s = tableCell(s); s == "" {
		return "—"
	}
	return s
}

// todoPart is the to-do table: one row per direction in rank order, with the task (at most 15 words), why in one
// sentence, the project files it touches and its kind. A direction summarized before those fields existed falls back
// (todoTask, todoWhy), and shows "—" for files and kind. The cockpit's Report draws the same rows
// (todoRows in frontend/app/view/agents/councilreporttables.ts): change one rule and change the other.
func todoPart(c *Council, w reportWords) string {
	if c.Summary == nil || len(c.Summary.Directions) == 0 {
		return ""
	}
	return sect(func(b *strings.Builder) {
		fmt.Fprintf(b, "## %s\n\n", w.todo)
		fmt.Fprintf(b, "| %s | %s | %s | %s | %s |\n|---|---|---|---|---|\n", w.colNo, w.colTask, w.colWhy, w.colFiles, w.colKind)
		for i, d := range c.Summary.Directions {
			fmt.Fprintf(b, "| %d | %s | %s | %s | %s |\n", i+1, cellOr(todoTask(c, d)), cellOr(todoWhy(d)), todoFiles(d), w.kindWord(d.Kind))
		}
	})
}

// todoTask is a direction's row title: its task; else a Brainstorm's first step, which is its idea's action; else the title.
func todoTask(c *Council, d CouncilDirection) string {
	if t := oneLine(d.Task); t != "" {
		return t
	}
	if isBrainstorm(c) {
		if s := oneLine(d.FirstStep); s != "" {
			return s
		}
	}
	return oneLine(d.Title)
}

// todoWhy is a direction's reason in one sentence: its why; else the first sentence of its reasoning read as one line
// (firstSentence, which also cuts it at briefMax characters).
func todoWhy(d CouncilDirection) string {
	if s := oneLine(d.Why); s != "" {
		return s
	}
	return firstSentence(oneLine(d.Reasoning))
}

// todoFiles is a direction's files as code, joined by commas; "—" for none.
func todoFiles(d CouncilDirection) string {
	var files []string
	for _, f := range d.Files {
		if f = tableCell(f); f != "" {
			files = append(files, "`"+f+"`")
		}
	}
	if len(files) == 0 {
		return "—"
	}
	return strings.Join(files, ", ")
}

// figuresPart is the figures table: the figures Go checked against the project's files (Cite is ok), each with what it
// measures and the line it comes from. It is empty when none checked out; the ones that did not are the side file's.
func figuresPart(c *Council, w reportWords) string {
	var rows []string
	for _, f := range c.Figures {
		if f.Cite == CiteOK {
			rows = append(rows, fmt.Sprintf("| %s | %s | %s |", cellOr(f.Value), cellOr(f.Measures), refCell(f.Ref)))
		}
	}
	if len(rows) == 0 {
		return ""
	}
	return fmt.Sprintf("## %s\n\n| %s | %s | %s |\n|---|---|---|\n%s", w.figures, w.colValue, w.colMeasures, w.colSource, strings.Join(rows, "\n"))
}

// refCell is a figure's `path:line` as code in a table cell; "—" with none.
func refCell(ref string) string {
	if ref = tableCell(ref); ref == "" {
		return "—"
	}
	return "`" + ref + "`"
}

// finalProposalPart is the message the person pinned (Council.FinalPick): the seat that wrote it, then its markdown. It
// is empty while nothing is pinned, or the pin names a message the council lacks.
func finalProposalPart(c *Council, w reportWords) string {
	body, ok := MessageMarkdown(c, c.FinalPick)
	if !ok {
		return ""
	}
	return fmt.Sprintf("## %s\n\n_%s %s_\n\n%s", w.finalProposal, w.fromSeat, messageSeatName(c, c.FinalPick), body)
}

// messageSeatName is the display name of the seat that wrote an idea or a reply. A chat seat is named for its tab, which
// is its project's name, so two chats of one project would read alike: its name carries its key (chatSeatKey), as the
// Report's header does (seatLabel in frontend/app/view/agents/councilmodel.ts).
func messageSeatName(c *Council, id string) string {
	author := ""
	if p := findProposal(c, id); p != nil {
		author = p.Author
	} else if r := findReply(c, id); r != nil {
		author = r.Author
	}
	if e, ok := seatOf(c, author); ok && e.Name != "" {
		if IsAgent(e) {
			return e.Name + " · " + chatSeatKey(c, e)
		}
		return e.Name
	}
	return speaker(c, author)
}

// chatSeatKey is the start of a chat seat's tab id that names it: minChatKey characters, or more until no other chat
// seat of the council shares it (any case), the way the cockpit's chatMentionKeys keys the chats. The cockpit also counts
// the chats its picker lists, which Go does not know, so a longer key there is possible; the file's key still tells the
// council's own chats apart once their tabs are gone.
func chatSeatKey(c *Council, seat CouncilExpert) string {
	id := seat.Agent
	lower := strings.ToLower(id)
	n := min(minChatKey, len(id))
	for n < len(id) && slices.ContainsFunc(c.Experts, func(o CouncilExpert) bool {
		return IsAgent(o) && o.Agent != seat.Agent && strings.HasPrefix(strings.ToLower(o.Agent), lower[:n])
	}) {
		n++
	}
	return id[:n]
}

// MessageMarkdown is one idea's or reply's markdown, the text the chat's Copy puts on the clipboard and the Final
// proposal section holds: a reply is its words, trimmed; an idea is its title as a heading, its argument, and when it
// has evidence one list line per item (evidenceItemText). A Review idea's checks and an item's quote, cite and region are
// left out. frontend/app/view/agents/councilfinalmodel.ts writes the same text (messageMarkdown). The bool is false for
// an id the council lacks.
func MessageMarkdown(c *Council, id string) (string, bool) {
	if id == "" {
		return "", false
	}
	if p := findProposal(c, id); p != nil {
		parts := []string{"## " + p.Title}
		if arg := strings.TrimSpace(p.Argument); arg != "" {
			parts = append(parts, arg)
		}
		if len(p.Evidence) > 0 {
			lines := make([]string, len(p.Evidence))
			for i, e := range p.Evidence {
				lines[i] = "- " + evidenceItemText(e)
			}
			parts = append(parts, strings.Join(lines, "\n"))
		}
		return strings.Join(parts, "\n\n"), true
	}
	if r := findReply(c, id); r != nil {
		return strings.TrimSpace(r.Text), true
	}
	return "", false
}

// memoryTime is a time the memory records, in ms, as the document writes it: UTC, to the minute.
func memoryTime(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02 15:04 UTC")
}

// memoryDirectionPart is the direction the person chose, above the answer, then the Earlier directions (newest first, each
// ending with how it left and when), so a reader never takes a direction the person left for the one in force. A council
// whose memory holds neither writes nothing; one whose chosen direction was unpinned says none is chosen now, and keeps the
// history. A waiting suggestion or a held direction is not a direction yet, so it is not here.
func memoryDirectionPart(c *Council, w reportWords) string {
	m := c.Memory
	if m == nil || (m.Chosen == nil && len(m.Replaced) == 0) {
		return ""
	}
	return sect(func(b *strings.Builder) {
		fmt.Fprintf(b, "## %s\n\n", w.chosen)
		if d := m.Chosen; d != nil {
			fmt.Fprintf(b, "%s\n\n", strings.TrimSpace(d.Text))
			meta := []string{w.how(*d)}
			if d.From != "" {
				meta = append(meta, w.from+" "+d.From)
			}
			if d.At > 0 {
				meta = append(meta, memoryTime(d.At))
			}
			fmt.Fprintf(b, "%s\n\n", strings.Join(meta, " · "))
			b.WriteString(w.outranks + "\n\n")
		} else {
			b.WriteString(w.noChosen + "\n\n")
		}
		if len(m.Replaced) == 0 {
			return
		}
		fmt.Fprintf(b, "### %s\n\n", w.earlier)
		for _, d := range m.Replaced {
			fmt.Fprintf(b, "- %s · %s", oneLine(d.Text), w.how(d))
			if d.From != "" {
				b.WriteString(" · " + w.from + " " + d.From)
			}
			fmt.Fprintf(b, " · %s", w.ended(d))
			if d.Replaced > 0 {
				b.WriteString(" " + memoryTime(d.Replaced))
			}
			b.WriteString("\n")
		}
	})
}

// memoryEntriesPart is what the council settled: the Agreed, Ruled out (with why) and Open entries of its memory, each
// kind under a heading of its own, only the kinds that have some.
func memoryEntriesPart(c *Council, w reportWords) string {
	m := c.Memory
	if m == nil {
		return ""
	}
	return sect(func(b *strings.Builder) {
		for _, k := range []struct{ kind, title string }{{EntryAgreed, w.agreed}, {EntryRuledOut, w.ruledOut}, {EntryOpen, w.open}} {
			entries := m.EntriesOf(k.kind)
			if len(entries) == 0 {
				continue
			}
			fmt.Fprintf(b, "## %s\n\n", k.title)
			for _, e := range entries {
				fmt.Fprintf(b, "- %s", oneLine(e.Text))
				if e.Why != "" {
					fmt.Fprintf(b, " (%s: %s)", w.why, oneLine(e.Why))
				}
				b.WriteString("\n")
			}
			b.WriteString("\n")
		}
	})
}

// askedOf is who a question to ask next goes to: the seat's name, or the whole panel.
func askedOf(c *Council, a CouncilAsk) string {
	if e, ok := seatOf(c, a.To); ok && a.To != "" {
		return "To " + e.Name
	}
	return "To the whole panel"
}

// oneLine is text as one trimmed line.
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// fromList names the proposals a direction came from, each with its author.
func fromList(c *Council, ids []string) string {
	from := make([]string, len(ids))
	for i, id := range ids {
		from[i] = id
		if p := findProposal(c, id); p != nil {
			from[i] = fmt.Sprintf("%s (%s)", id, speaker(c, p.Author))
		}
	}
	return strings.Join(from, ", ")
}

func writeDirection(b *strings.Builder, c *Council, n int, d CouncilDirection) {
	verdict := "Split"
	if d.Agreed {
		verdict = "Agreed"
	}
	fmt.Fprintf(b, "%d. **%s** (%s)\n", n, d.Title, verdict)
	if len(d.From) > 0 {
		fmt.Fprintf(b, "   From %s.\n", fromList(c, d.From))
	}
	if r := strings.TrimSpace(d.Reasoning); r != "" {
		b.WriteString("   " + strings.ReplaceAll(r, "\n", "\n   ") + "\n")
	}
	if s := oneLine(d.FirstStep); s != "" {
		fmt.Fprintf(b, "   First step: %s\n", s)
	}
	if stances := stanceList(c, d.Stances); stances != "" {
		fmt.Fprintf(b, "   Stances: %s.\n", stances)
	}
	b.WriteString("\n")
}

// writeKept is one line of Kept (a wild idea kept aside, or a direction also raised): its title, who it came from, and
// its line of reasoning.
func writeKept(b *strings.Builder, c *Council, d CouncilDirection) {
	fmt.Fprintf(b, "- **%s**", d.Title)
	if len(d.From) > 0 {
		fmt.Fprintf(b, " (from %s)", fromList(c, d.From))
	}
	if r := oneLine(d.Reasoning); r != "" {
		b.WriteString(": " + r)
	}
	b.WriteString("\n")
}

// stanceList names each expert's stance in the panel's order; an id the panel does not hold follows, sorted.
func stanceList(c *Council, stances map[string]CouncilStance) string {
	var parts []string
	seen := map[string]bool{}
	for _, e := range c.Experts {
		if s, ok := stances[e.Id]; ok {
			parts = append(parts, fmt.Sprintf("%s %s", e.Name, s))
			seen[e.Id] = true
		}
	}
	var rest []string
	for id := range stances {
		if !seen[id] {
			rest = append(rest, id)
		}
	}
	sort.Strings(rest)
	for _, id := range rest {
		parts = append(parts, fmt.Sprintf("%s %s", id, stances[id]))
	}
	return strings.Join(parts, ", ")
}

// tableCell makes text safe inside a table cell: one line, no bare pipe.
func tableCell(s string) string {
	return strings.ReplaceAll(strings.Join(strings.Fields(s), " "), "|", `\|`)
}

func writeMatrix(b *strings.Builder, c *Council) {
	var panel []CouncilExpert
	for _, e := range c.Experts {
		if !e.Coordinator {
			panel = append(panel, e)
		}
	}
	head, rule := "| Proposal |", "|---|"
	for _, e := range panel {
		head += " " + tableCell(e.Name) + " |"
		rule += "---|"
	}
	b.WriteString(head + " Outcome |\n" + rule + "---|\n")
	for _, p := range sentProposals(c) {
		title := p.Title
		if p.Wild && isBrainstorm(c) {
			title += " (wild idea)"
		}
		if w := labelWord(docLabel(c, p.Label)); w != "" {
			title += " (" + w + ")"
		}
		fmt.Fprintf(b, "| %s |", tableCell(p.Id+" · "+title))
		for _, e := range panel {
			b.WriteString(" " + matrixCell(c, p, e) + " |")
		}
		b.WriteString(" " + matrixOutcome(c, p) + " |\n")
	}
}

// matrixCell is one expert's stance on one proposal and the line of reason it gave, from its first reply straight
// to the proposal.
func matrixCell(c *Council, p CouncilProposal, e CouncilExpert) string {
	if p.Author == e.Id {
		return "author"
	}
	for _, r := range c.Replies {
		if r.ProposalId != p.Id || r.Author != e.Id || r.ParentId != "" || r.Stance == "" || !Sent(r.Draft) {
			continue
		}
		reason := strings.Join(strings.Fields(proseOf(r.Text)), " ")
		if runes := []rune(reason); len(runes) > matrixReasonRunes {
			reason = strings.TrimSpace(string(runes[:matrixReasonRunes])) + "…"
		}
		return tableCell(string(r.Stance) + ": " + reason)
	}
	return "—"
}

func matrixOutcome(c *Council, p CouncilProposal) string {
	if c.Summary != nil {
		if o := strings.TrimSpace(c.Summary.Outcomes[p.Id]); o != "" {
			return tableCell(o)
		}
	}
	switch {
	case p.Cut:
		return "Cut at the pause"
	case p.Withdrawn:
		return "Withdrawn"
	}
	return "—"
}

// ---- the saved document ----

// Document is what a finished council saves into its project, both files one after the other, as `wsh read` prints it:
// the main report (reportMain), then its side file (reportSide: the at-a-glance chart, the directions in full, the
// matrix, the discussion, the run facts and the charts of what each seat spent). It names the files by the path the
// council was saved at, else by the one a save would pick now.
func Document(c *Council) string { return documentWith(c, nil, nil) }

// documentWith is Document with each message's screenshot regions embedded under its evidence line: crops maps a region's
// crop PNG to the relative link the document reaches its copy by (WriteDocument copies them). A region it does not map
// stays the text ref alone. With roots it also checks every `path:line` the report and the discussion cite against them
// (AuditReportCites) and puts the "Cite check" section in the side file; with none it reads no file.
func documentWith(c *Council, crops map[string]string, roots []string) string {
	mainName := docFileName(c)
	main := reportMain(c, SidePath(mainName))
	return main + "\n" + reportSide(c, mainName, main, crops, roots)
}

// reportMain is the saved report's main file: the sections mainParts writes, the Final proposal while one is pinned, and
// the line that links the side file, named sideName (its base name: both files sit in one folder).
func reportMain(c *Council, sideName string) string {
	w := wordsOf(c)
	parts := mainParts(c, w)
	return joinParts(append(parts, finalProposalPart(c, w), fmt.Sprintf(w.sideLink, sideName))...)
}

// failedFiguresHeading is the side file's section of the figures that did not check out. The cite check does not read it
// as the report's own cites (splitReport): its refs are the failed ones, listed with why.
const failedFiguresHeading = "Figures that did not check out"

// reportSide is the saved report's side file, English whatever the council's language: a link back to the main file
// (named mainName), the at-a-glance chart, the detail (detailParts), the figures that did not check out, the files the
// council could not copy into the project, the cite check, the whole discussion and the run facts. main is the main
// file's text, which the cite check reads together with the side file's own. crops and roots are documentWith's.
func reportSide(c *Council, mainName, main string, crops map[string]string, roots []string) string {
	var disc strings.Builder
	writeDiscussion(&disc, c, crops)
	parts := []string{
		"# Council discussion: " + c.Feature,
		fmt.Sprintf("The report: [%[1]s](%[1]s).", mainName),
		sect(func(b *strings.Builder) { writeGlanceChart(b, c) }),
	}
	parts = append(parts, detailParts(c)...)
	parts = append(parts, failedFiguresPart(c), briefsPart(c))
	if len(roots) > 0 && !isBrainstorm(c) {
		audit := AuditReportCites(main+"\n"+joinParts(parts...)+"\n## The discussion\n\n"+disc.String(), roots)
		parts = append(parts, sect(func(b *strings.Builder) { writeCiteCheck(b, audit) }))
	}
	parts = append(parts, "## The discussion\n\n"+disc.String(), sect(func(b *strings.Builder) {
		b.WriteString("## Run facts\n\n")
		writeRunFacts(b, c)
		writeRunCharts(b, c)
	}))
	return joinParts(parts...)
}

// failedFiguresPart lists the figures the seats declared that Go could not confirm against the project's files, each
// with why, so a number left out of the report's Figures table is not lost. It is empty when every figure checked out.
func failedFiguresPart(c *Council) string {
	var rows []string
	for _, f := range c.Figures {
		if f.Cite == CiteOK {
			continue
		}
		note := oneLine(f.CiteNote)
		if note == "" {
			note = "not checked"
		}
		rows = append(rows, fmt.Sprintf("| %s | %s | %s | %s |", cellOr(f.Value), cellOr(f.Measures), refCell(f.Ref), tableCell(note)))
	}
	if len(rows) == 0 {
		return ""
	}
	return "## " + failedFiguresHeading + "\n\n" +
		"The seats declared these numbers; Go could not confirm them against the files, so the report's Figures table leaves them out.\n\n" +
		"| Value | Measures | Source | Why |\n|---|---|---|---|\n" + strings.Join(rows, "\n")
}

// briefsPart lists the files given to the council from outside its project that Start could not copy into it, with why:
// the council read each where it is, so a cite of one may not resolve on another machine. It is empty when none failed.
func briefsPart(c *Council) string {
	var lines []string
	for _, br := range c.Briefs {
		if br.Skipped != "" {
			lines = append(lines, fmt.Sprintf("- `%s`: %s", br.Source, oneLine(br.Skipped)))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "## Files not copied\n\n" +
		"These files lie outside the project and were not copied into `docs/council/briefs/`, so the council read them where they are.\n\n" +
		strings.Join(lines, "\n")
}

// docName is who said a message, as the document names them.
func docName(c *Council, id string) string {
	if id == YouId {
		return "You"
	}
	return speaker(c, id)
}

// indent puts prefix before every line of s that holds something.
func indent(s, prefix string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i, l := range lines {
		if strings.TrimSpace(l) != "" {
			lines[i] = prefix + l
		}
	}
	return strings.Join(lines, "\n")
}

// listMarker is the marker a Markdown list item opens with: "1. ", "2) ", "- ", "* " or "+ ".
var listMarker = regexp.MustCompile(`^\s*(?:\d+[.)]|[-*+])\s+`)

// proseOf is a message without its tables, diagrams and code blocks, and its list items as plain lines: a matrix cell
// has room for words only. The Summary's matrix keeps the same rule (proseOf in frontend/app/view/agents/councilmodel.ts).
func proseOf(text string) string {
	var out []string
	fenced := false
	for line := range strings.SplitSeq(text, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			fenced = !fenced
			continue
		}
		if fenced || strings.HasPrefix(t, "|") {
			continue
		}
		out = append(out, listMarker.ReplaceAllString(line, ""))
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// labelWord is the word the document gives a claim's check label (the Label* values): "Ran", "Disproved", "Read code" or
// "Guess". It is empty for no label, and for a word nothing labels with. The side file's own words are English, whatever
// the council's language, and so are the prompts' (the main file's own words follow the council's language: reportWords);
// the Map and the chips draw the council's language from their own table.
func labelWord(label string) string {
	switch label {
	case LabelRan:
		return "Ran"
	case LabelDisproved:
		return "Disproved"
	case LabelRead:
		return "Read code"
	case LabelGuess:
		return "Guess"
	}
	return ""
}

// docLabel is the label c's document shows for a claim: none in a Brainstorm, whose ideas are checked for the coordinator
// but whose labels the UI hides, so the document hides them too; label itself otherwise.
func docLabel(c *Council, label string) string {
	if isBrainstorm(c) {
		return ""
	}
	return label
}

// docTailLines is how much of a result's output the document keeps: all the record holds.
const docTailLines = 40

// resultFence is the code fence for lines of a result's output: three backticks, or one more than the longest run of them
// in the output, so the output cannot close its own fence.
func resultFence(lines []string) string {
	longest, run := 0, 0
	for _, l := range lines {
		run = 0
		for _, r := range l {
			if r == '`' {
				run++
				longest = max(longest, run)
			} else {
				run = 0
			}
		}
	}
	return strings.Repeat("`", max(3, longest+1))
}

// docEvidenceText is evidenceText with a wrong cite named beside its ref, with why: the document keeps what the check
// found, so a claim read as Read code shows which of its cites did not hold.
func docEvidenceText(ev []CouncilEvidence) string {
	marked := make([]CouncilEvidence, len(ev))
	for i, e := range ev {
		if e.Cite == CiteWrong && e.Ref != "" {
			if note := oneLine(e.CiteNote); note != "" {
				e.Ref += " (wrong cite: " + note + ")"
			} else {
				e.Ref += " (wrong cite)"
			}
		}
		marked[i] = e
	}
	return evidenceText(marked)
}

// docChecks are the lines a message of the document carries for the check of its claim: the label word, then each verify
// request with what became of it and the end of its output. It is empty for a claim nothing labels and nothing ran for.
func docChecks(label string, runs []CouncilRun) string {
	var b strings.Builder
	if w := labelWord(label); w != "" {
		fmt.Fprintf(&b, "Check: %s\n", w)
	}
	for _, r := range runs {
		fmt.Fprintf(&b, "Verify `%s`: %s\n", resultCommand(r), resultText(r))
		if lines := resultLines(r.Tail, docTailLines); len(lines) > 0 {
			fence := resultFence(lines)
			b.WriteString(fence + "text\n" + strings.Join(lines, "\n") + "\n" + fence + "\n")
		}
	}
	return b.String()
}

// writeMessage is one message of the discussion: who, the label in plain words, what it is about, its words, its
// evidence with the image of each screenshot region crops maps, and the check of its claim (docChecks), which is empty
// for a message that makes none.
func writeMessage(b *strings.Builder, who, label, about, body string, evidence []CouncilEvidence, checks string, crops map[string]string) {
	fmt.Fprintf(b, "- **%s** %s", who, label)
	if about != "" {
		b.WriteString(" · " + about)
	}
	b.WriteString("\n")
	if strings.TrimSpace(body) != "" {
		b.WriteString(indent(body, "  ") + "\n")
	}
	if len(evidence) > 0 {
		fmt.Fprintf(b, "  Evidence: %s\n", docEvidenceText(evidence))
	}
	for _, e := range evidence {
		if e.Region == nil || e.Cite == CiteWrong {
			continue
		}
		if link, ok := crops[e.Region.Crop]; ok {
			fmt.Fprintf(b, "  ![%s](%s)\n", regionAlt(e.Ref), link)
		}
	}
	if strings.TrimSpace(checks) != "" {
		b.WriteString(indent(checks, "  ") + "\n")
	}
}

// proposalLabel is a proposal's label: a Review's "proposes", a Brainstorm's "idea" or "wild idea".
func proposalLabel(c *Council, p CouncilProposal) string {
	switch {
	case !isBrainstorm(c):
		return "proposes"
	case p.Wild:
		return "wild idea"
	}
	return "idea"
}

// replyLabel is a reply's label in plain words. An accept with no words is a reaction ("agrees"), and so is an answer to
// the person with no words and no stance (a seat with nothing to add to the answer before it); the document keeps each
// as a line of its own rather than dropping it.
func replyLabel(c *Council, r CouncilReply) string {
	spoke := strings.TrimSpace(r.Text) != ""
	switch {
	case r.Author == YouId && r.ProposalId == "" && r.ParentId == "":
		return "steers"
	case r.Withdraws:
		return "withdraws it"
	case r.Revised && r.Author != YouId:
		return "revises it"
	case r.Author == YouId:
		return "replies"
	case r.Stance == StanceChallenge:
		return "has doubts"
	case r.Stance == StanceOppose:
		return "is against it"
	case (r.Stance == StanceAccept || r.Stance == "") && !spoke:
		return "agrees"
	case r.Stance == StanceAccept && r.Builds && isBrainstorm(c):
		return "builds on it"
	}
	return "replies"
}

// proposalRef is "P1 · Title", or just the id for a proposal the council no longer holds.
func proposalRef(c *Council, id string) string {
	if p := findProposal(c, id); p != nil {
		return id + " · " + oneLine(p.Title)
	}
	return id
}

func proposalMessage(c *Council, p CouncilProposal, crops map[string]string) string {
	var b strings.Builder
	about := proposalRef(c, p.Id)
	switch {
	case p.Cut:
		about += " (cut at the pause)"
	case p.Withdrawn:
		about += " (withdrawn)"
	}
	writeMessage(&b, docName(c, p.Author), proposalLabel(c, p), about, p.Argument, p.Evidence, docChecks(docLabel(c, p.Label), p.Runs), crops)
	return b.String()
}

func replyMessage(c *Council, r CouncilReply, crops map[string]string) string {
	var b strings.Builder
	about := ""
	switch {
	case r.ProposalId != "":
		about = "on " + proposalRef(c, r.ProposalId)
	case r.Author == YouId:
		about = "to the whole council"
	}
	if parent := findReply(c, r.ParentId); parent != nil {
		about += " (replying to " + docName(c, parent.Author) + ")"
	}
	text := r.Text
	if t := strings.TrimSpace(r.Retitled); t != "" {
		text = strings.TrimSpace("New title: " + oneLine(t) + ". " + text)
	}
	writeMessage(&b, docName(c, r.Author), replyLabel(c, r), strings.TrimSpace(about), text, r.Evidence, docChecks(docLabel(c, r.Label), nil), crops)
	return b.String()
}

// writeDiscussion lists the person's question as the goal, then every proposal and reply in time order. Proposals
// come before replies of the same instant, and the order they were saved in breaks the rest.
func writeDiscussion(b *strings.Builder, c *Council, crops map[string]string) {
	type message struct {
		ts   int64
		text string
	}
	var msgs []message
	for _, p := range sentProposals(c) { // a held or dropped draft is not in the room, so not in the document
		msgs = append(msgs, message{p.Ts, proposalMessage(c, p, crops)})
	}
	for _, r := range c.Replies {
		if Sent(r.Draft) {
			msgs = append(msgs, message{r.Ts, replyMessage(c, r, crops)})
		}
	}
	sort.SliceStable(msgs, func(i, j int) bool { return msgs[i].ts < msgs[j].ts })
	q := oneLine(c.Question)
	if q != "" {
		writeMessage(b, "You", "sets the goal", "", q, nil, "", nil)
	}
	for _, m := range msgs {
		b.WriteString(m.text)
	}
	if q == "" && len(msgs) == 0 {
		b.WriteString("_Nothing was said._\n")
	}
}

// docDuration is a span in milliseconds in words: "45 s", "6 min 12 s", "1 h 5 min".
func docDuration(ms int64) string {
	secs := (ms + 500) / 1000
	switch {
	case secs < 60:
		return fmt.Sprintf("%d s", secs)
	case secs < 3600:
		if secs%60 == 0 {
			return fmt.Sprintf("%d min", secs/60)
		}
		return fmt.Sprintf("%d min %d s", secs/60, secs%60)
	}
	return fmt.Sprintf("%d h %d min", secs/3600, secs%3600/60)
}

// writeRunFacts is how the council ran: its mode and why, the experts and their models, what it cost and how it ended.
func writeRunFacts(b *strings.Builder, c *Council) {
	mode := "Review"
	if isBrainstorm(c) {
		mode = "Brainstorm"
	}
	if why := oneLine(c.ModeWhy); why != "" {
		mode += " · " + why
	}
	fmt.Fprintf(b, "- Mode: %s\n", mode)
	var experts []string
	for _, e := range c.Experts {
		name := e.Name
		if name == "" {
			name = e.Id
		}
		var tags []string
		if IsAgent(e) {
			tags = append(tags, "agent "+e.Harness)
		} else if e.Model != "" {
			tags = append(tags, e.Model)
		}
		if e.Coordinator {
			tags = append(tags, "coordinator")
		}
		if len(tags) > 0 {
			name += " (" + strings.Join(tags, ", ") + ")"
		}
		experts = append(experts, name)
	}
	if len(experts) > 0 {
		fmt.Fprintf(b, "- Experts: %s\n", strings.Join(experts, ", "))
	}
	var panel []CouncilExpert
	for _, e := range c.Experts {
		if !e.Coordinator {
			panel = append(panel, e)
		}
	}
	if len(panel) > 1 && len(c.Picks) > 0 {
		fmt.Fprintf(b, "- Picks: %d experts on %s; picks from one model are not independent votes\n", len(panel), modelsWord(panel))
	}
	if c.Harness != "" {
		fmt.Fprintf(b, "- Harness: %s\n", c.Harness)
	}
	if c.RepeatOf != "" {
		why := "the council was upgraded since"
		if c.RepeatWhy == RepeatNewEvidence {
			why = "new evidence: " + oneLine(c.RepeatEvidence)
		}
		fmt.Fprintf(b, "- Repeats: %s, %s\n", c.RepeatOf, why)
	}
	for _, s := range c.Skips {
		fmt.Fprintf(b, "- Skipped: %s in round %d: %s\n", docName(c, s.Expert), s.Round, oneLine(s.Reason))
	}
	for _, rt := range c.Retries {
		why := ""
		if rt.Auto {
			why = "; Claude's safeguards flagged it"
		}
		fmt.Fprintf(b, "- Retried: %s in round %d on %s (its seat is %s%s)\n", docName(c, rt.Expert), rt.Round, rt.Model, rt.Was, why)
	}
	// a call still failed: what it was asked is missing from the report, though the council reads as done
	for _, e := range c.Experts {
		if f, ok := c.Failed[e.Id]; ok {
			fmt.Fprintf(b, "- Failed: %s in round %d: %s (`wsh council retry %s --expert %s` runs it again)\n",
				docName(c, e.Id), f.Round, oneLine(f.Error), c.Id, e.Id)
		}
	}
	fmt.Fprintf(b, "- Tokens: %s in %d calls\n", FormatTokens(c.Tokens), c.Calls)
	if c.Started > 0 && c.Updated > c.Started {
		fmt.Fprintf(b, "- Time: %s\n", docDuration(c.Updated-c.Started))
	}
	fmt.Fprintf(b, "- Ended: %s\n", c.State)
}
