// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// councilRunner runs every council in wavesrv, through the real claude caller. A test replaces it with a fake caller.
var councilRunner = newCouncilRunner(council.ConsultCaller{})

func newCouncilRunner(caller council.Caller) *council.Runner {
	return &council.Runner{Caller: caller, OnChange: publishCouncilChanged}
}

// publishCouncilChanged tells the cockpit and `wsh council wait` that a council was saved.
func publishCouncilChanged(c *council.Council) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_CouncilChanged, Data: wshrpc.CouncilChangedData{Id: c.Id, Project: c.Project}})
}

// StartCouncilRunner is called once at startup: a council left running when wavesrv last quit has no run behind it, so
// it is marked stopped. A council with a live run is left alone.
func StartCouncilRunner() {
	councilRunner.MarkStale()
}

// councilDocDay is the date a saved doc's default file name starts with; a test replaces it.
var councilDocDay = func() time.Time { return time.Now() }

// councilDocSlugRunes cuts a feature's slug so a long feature does not make a long file name.
const councilDocSlugRunes = 60

// councilPanel is the experts of a new council: the ones named, else the panel of the group (the coordinator last).
// An unknown group is an error.
func councilPanel(group string, experts []council.CouncilExpert) ([]council.CouncilExpert, error) {
	if len(experts) > 0 {
		return experts, nil
	}
	if strings.TrimSpace(group) == "" {
		return nil, errors.New("a council needs a group or a list of experts")
	}
	return council.ExpertsFor(group)
}

// CouncilStartCommand starts a council and returns it as saved: the rounds run in the background, so the council it
// returns is running at round 1 (or not-run), and the council:changed events carry the rest. Id alone starts the saved
// not-run council of that id.
func (ws *WshServer) CouncilStartCommand(ctx context.Context, data wshrpc.CommandCouncilStartData) (*council.Council, error) {
	// the rounds outlive this request, so they get their own context: Stop is what ends them
	if data.Id != "" {
		return councilRunner.StartSaved(context.Background(), data.Id)
	}
	if data.Mode != "" && data.Mode != council.ModeReview && data.Mode != council.ModeBrainstorm {
		return nil, fmt.Errorf("unknown council mode %q: use %s or %s", data.Mode, council.ModeReview, council.ModeBrainstorm)
	}
	experts, err := councilPanel(data.Group, data.Experts)
	if err != nil {
		return nil, err
	}
	c := &council.Council{
		Project:          data.Project,
		Feature:          data.Feature,
		Question:         data.Question,
		Files:            data.Files,
		Screenshots:      data.Screenshots,
		Group:            data.Group,
		Mode:             data.Mode,
		ModeWhy:          data.ModeWhy,
		Experts:          experts,
		PauseAfterRound1: data.Pause,
		SessionId:        data.SessionId,
	}
	if data.NotRun {
		return councilRunner.Record(c)
	}
	return councilRunner.Start(context.Background(), c)
}

func (ws *WshServer) CouncilListCommand(ctx context.Context, data wshrpc.CommandCouncilListData) ([]*council.Council, error) {
	return council.List(data.Project)
}

func (ws *WshServer) CouncilGetCommand(ctx context.Context, data wshrpc.CommandCouncilIdData) (*council.Council, error) {
	if data.Id == "" {
		return nil, errors.New("a council id is required")
	}
	return council.Load(data.Id)
}

// CouncilReplyCommand posts the person's reply; the runner checks the proposal and the parent exist and answers it.
func (ws *WshServer) CouncilReplyCommand(ctx context.Context, data wshrpc.CommandCouncilReplyData) error {
	_, err := councilRunner.Reply(data.Id, data.ProposalId, data.ParentId, data.Text, data.Tools)
	return err
}

func (ws *WshServer) CouncilContinueCommand(ctx context.Context, data wshrpc.CommandCouncilContinueData) error {
	_, err := councilRunner.Continue(data.Id, data.Cut, data.Question)
	return err
}

func (ws *WshServer) CouncilSummarizeCommand(ctx context.Context, data wshrpc.CommandCouncilIdData) error {
	_, err := councilRunner.Summarize(data.Id)
	return err
}

// CouncilStopCommand returns once the run has saved the council as stopped, which waits for the calls in flight to be
// cancelled: 15 seconds at the longest.
func (ws *WshServer) CouncilStopCommand(ctx context.Context, data wshrpc.CommandCouncilIdData) error {
	_, err := councilRunner.Stop(data.Id)
	return err
}

func (ws *WshServer) CouncilRetryCommand(ctx context.Context, data wshrpc.CommandCouncilRetryData) error {
	_, err := councilRunner.Retry(data.Id, data.ExpertId)
	return err
}

// CouncilSuggestCommand makes the one claude call behind Setup's suggestion. It answers the request, so it ends with it.
func (ws *WshServer) CouncilSuggestCommand(ctx context.Context, data wshrpc.CommandCouncilSuggestData) (*council.CouncilSuggestion, error) {
	s, err := councilRunner.Suggest(ctx, data.Project, data.Feature, data.Question, data.Files)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (ws *WshServer) CouncilEstimateCommand(ctx context.Context, data wshrpc.CommandCouncilEstimateData) (*wshrpc.CouncilEstimateRtnData, error) {
	var est council.CouncilEstimate
	switch {
	case data.Id != "" && data.Followup > 0:
		est = council.EstimateFollowup(data.Followup, data.Tools)
	case data.Id != "":
		c, err := council.Load(data.Id)
		if err != nil {
			return nil, err
		}
		est = council.EstimateRemaining(c)
	default:
		est = council.Estimate(data.Experts, councilFileBytes(data.Project, data.Files))
	}
	return &wshrpc.CouncilEstimateRtnData{Calls: est.Calls, Tokens: est.Tokens, Minutes: est.Minutes}, nil
}

// councilSkipDirs are folders a council's file list never reads into: a folder in the list counts the files in it,
// and these would count a whole repository's history or dependencies.
var councilSkipDirs = map[string]bool{".git": true, "node_modules": true}

// councilFileBytes is the size of what a council puts in front of its experts: a path is under the project unless it
// is absolute, and a folder counts the files in it. A path that cannot be read counts for nothing.
func councilFileBytes(project string, files []string) int64 {
	var total int64
	for _, f := range files {
		path := f
		if !filepath.IsAbs(path) {
			path = filepath.Join(project, path)
		}
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			total += info.Size()
			continue
		}
		filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if p != path && councilSkipDirs[d.Name()] {
					return fs.SkipDir
				}
				return nil
			}
			if fi, err := d.Info(); err == nil && fi.Mode().IsRegular() {
				total += fi.Size()
			}
			return nil
		})
	}
	return total
}

// councilFeatureSlug is a feature as a file name part: letters and digits, lower case, runs of anything else one dash.
func councilFeatureSlug(feature string) string {
	var b strings.Builder
	runes, dash := 0, false
	for _, r := range strings.ToLower(feature) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) {
			b.WriteRune(r)
			runes++
			dash = false
		} else if !dash && runes > 0 {
			b.WriteByte('-')
			runes++
			dash = true
		}
		if runes >= councilDocSlugRunes {
			break
		}
	}
	if slug := strings.Trim(b.String(), "-"); slug != "" {
		return slug
	}
	return "council"
}

// councilDocPath is where a doc is written: the default path, or the one asked for, under the project. A path
// outside the project is refused.
func councilDocPath(c *council.Council, asked string) (string, error) {
	project := strings.TrimSpace(c.Project)
	if project == "" {
		return "", fmt.Errorf("council %s has no project folder to save a doc into", c.Id)
	}
	project = filepath.Clean(project)
	path := strings.TrimSpace(asked)
	if path == "" {
		path = filepath.Join("docs", "council", councilDocDay().Format("2006-01-02")+"-"+councilFeatureSlug(c.Feature)+".md")
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(project, path)
	}
	path = filepath.Clean(path)
	rel, err := filepath.Rel(project, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s is outside the project %s", path, project)
	}
	return path, nil
}

// CouncilSaveDocCommand writes the council's Summary and Matrix as markdown into its project. It writes the file and
// nothing else: it never stages or commits.
func (ws *WshServer) CouncilSaveDocCommand(ctx context.Context, data wshrpc.CommandCouncilSaveDocData) (*wshrpc.CouncilSaveDocRtnData, error) {
	if data.Id == "" {
		return nil, errors.New("a council id is required")
	}
	c, err := council.Load(data.Id)
	if err != nil {
		return nil, err
	}
	path, err := councilDocPath(c, data.Path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(council.Markdown(c)), 0o644); err != nil {
		return nil, fmt.Errorf("writing %s: %w", path, err)
	}
	return &wshrpc.CouncilSaveDocRtnData{Path: path}, nil
}

func (ws *WshServer) CouncilRolesCommand(ctx context.Context) (*wshrpc.CouncilRolesRtnData, error) {
	return &wshrpc.CouncilRolesRtnData{Roles: council.Roles(), Groups: council.Groups()}, nil
}

func (ws *WshServer) CouncilSaveGroupCommand(ctx context.Context, data council.CouncilGroup) error {
	return council.SaveGroup(data)
}
