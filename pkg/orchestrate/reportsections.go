// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// capSection bounds one report section to reportSectionMaxLen runes. Over it, the text is cut at the last line
// boundary at or below the limit (at the limit when the first line is longer) and ends with the command that reads
// the rest, so nothing reaches a reader shortened without saying so. An empty key names the whole report.
func capSection(taskID, key, text string) string {
	return capText(text, reportSectionMaxLen, strings.TrimSpace(fmt.Sprintf("wsh jarvis dag report %s %s", taskID, key)))
}

// capText is capSection's cut for any text: past limit runes, at the last line boundary, naming cmd for the rest.
func capText(text string, limit int, cmd string) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	cut := limit
	if runes[cut] != '\n' {
		for i := cut - 1; i > 0; i-- {
			if runes[i] == '\n' {
				cut = i
				break
			}
		}
	}
	return strings.TrimRight(string(runes[:cut]), " \t\n") + fmt.Sprintf("\n… %d more characters: %s", len(runes)-cut, cmd)
}

// workerReportOf reads a run's sealed report: sections when it parses, the trimmed text when it predates the format.
func workerReportOf(run *waveobj.Run) (rep jarvis.WorkerReport, unstructured string) {
	if run == nil || run.Evidence == nil {
		return jarvis.WorkerReport{}, ""
	}
	return jarvis.ReadWorkerReport(run.Evidence.Summary)
}

// leadSectionLines are the sections the lead acts on, one line each; Done and For later tasks go elsewhere.
func leadSectionLines(taskID string, run *waveobj.Run) []string {
	rep, unstructured := workerReportOf(run)
	if unstructured != "" {
		return []string{fmt.Sprintf("%s unstructured report: %s", taskID, capSection(taskID, "", unstructured))}
	}
	var lines []string
	for _, key := range []string{jarvis.ReportKeyDiffers, jarvis.ReportKeyNotVerified, jarvis.ReportKeyFoundNotFixed} {
		body, _ := rep.Section(key)
		if body == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf("%s %s: %s", taskID, sectionHeading(key), capSection(taskID, key, body)))
	}
	return lines
}

// landedLines are the lines a fast-track task gives the lead when it lands, the ones a review pass gives on the full
// track: a quiet line saying how it landed, then a caveat line per section the lead acts on. Its For later tasks
// joins them only when no later task reads it at dispatch (predecessorHandoff).
func landedLines(g *waveobj.TaskGroup, taskID string, worker *waveobj.Run, how string) (quiet string, caveats []string) {
	caveats = leadSectionLines(taskID, worker)
	if rep, _ := workerReportOf(worker); rep.ForLater != "" && !forLaterHasReader(g, taskID) {
		caveats = append(caveats, fmt.Sprintf("%s %s: %s", taskID, sectionHeading(jarvis.ReportKeyForLater), capSection(taskID, jarvis.ReportKeyForLater, rep.ForLater)))
	}
	return taskID + " " + how, caveats
}

// postLanded queues landedLines for the lead's next wake. Like a review pass's, they start no wake of their own.
func postLanded(ctx context.Context, g *waveobj.TaskGroup, quiet string, caveats []string) {
	PostQuiet(ctx, g.ChannelId, g.RunID, quiet)
	// the caveats are what the lead must act on, so they travel whole
	for _, c := range caveats {
		PostCaveat(ctx, g.ChannelId, g.RunID, flatLine(c))
	}
}

func sectionHeading(key string) string {
	for _, s := range jarvis.WorkerReportSections {
		if s.Key == key {
			return s.Heading
		}
	}
	return key
}

// taskCaveats are what could not be verified about a landed task: the worker's Not verified (a legacy report whole,
// since its caveats can't be told apart from the rest), then the reviewer's addition. The run-end report, the final
// stage and the verifier's brief all read it, so the three can't drift. A task that did not land has none: nothing
// of it reached the result.
func taskCaveats(t *waveobj.TaskNode, worker *waveobj.Run) []string {
	if t.State != TaskState_Done {
		return nil
	}
	rep, unstructured := workerReportOf(worker)
	var out []string
	for _, c := range []string{rep.NotVerified, unstructured} {
		if c != "" {
			out = append(out, c)
		}
	}
	if t.ReviewUnverified != "" {
		out = append(out, "reviewer: "+t.ReviewUnverified)
	}
	return out
}

// dagCaveatLines are every landed task's caveats, each prefixed with its task id, in dag order. A worker run that
// can't be read leaves the task's reviewer caveat alone.
func dagCaveatLines(ctx context.Context, g *waveobj.TaskGroup) []string {
	var out []string
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State != TaskState_Done {
			continue
		}
		var worker *waveobj.Run
		if t.RunID != "" {
			run, err := wstore.GetRun(ctx, g.ChannelId, t.RunID)
			if err != nil {
				log.Printf("dag %s: reading %s's worker run for its caveats: %v", g.OID, t.ID, err)
			}
			worker = run
		}
		for _, c := range taskCaveats(t, worker) {
			out = append(out, t.ID+": "+c)
		}
	}
	return out
}
