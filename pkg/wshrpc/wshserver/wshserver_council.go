// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

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
// it is marked stopped. A council with a live run is left alone. A council that was queued when wavesrv quit stays
// queued, and the oldest one starts now.
func StartCouncilRunner() {
	councilRunner.MarkStale()
	councilRunner.StartNext()
}

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

// CouncilListCommand is the cockpit's list, so it leaves out the councils the benchmark started: they raise no notice,
// tree row or Needs you item. The queue reads council.List itself and still sees them; CouncilGetCommand still loads one.
func (ws *WshServer) CouncilListCommand(ctx context.Context, data wshrpc.CommandCouncilListData) ([]*council.Council, error) {
	all, err := council.List(data.Project)
	if err != nil {
		return nil, err
	}
	shown := make([]*council.Council, 0, len(all))
	for _, c := range all {
		if !c.Bench {
			shown = append(shown, c)
		}
	}
	return shown, nil
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

// CouncilSaveDocCommand writes the council's document (the report, the whole discussion and the run facts) into its
// project, at the path asked for or the default one. It writes the file and nothing else: it never stages or commits.
// The path is kept on the council (DocPath) and announced, so the report can open the document, and the next save,
// like the one a finished council makes by itself, rewrites the same file instead of starting a -2 copy.
func (ws *WshServer) CouncilSaveDocCommand(ctx context.Context, data wshrpc.CommandCouncilSaveDocData) (*wshrpc.CouncilSaveDocRtnData, error) {
	if data.Id == "" {
		return nil, errors.New("a council id is required")
	}
	c, err := council.Load(data.Id)
	if err != nil {
		return nil, err
	}
	path, err := council.WriteDocument(c, data.Path)
	if err != nil {
		return nil, err
	}
	if path != c.DocPath {
		saved, err := council.Update(c.Id, func(c *council.Council) error {
			c.DocPath = path
			return nil
		})
		if err != nil {
			log.Printf("[council] %s: document path not kept: %v", c.Id, err)
		} else {
			publishCouncilChanged(saved)
		}
	}
	return &wshrpc.CouncilSaveDocRtnData{Path: path}, nil
}

func (ws *WshServer) CouncilRolesCommand(ctx context.Context) (*wshrpc.CouncilRolesRtnData, error) {
	return &wshrpc.CouncilRolesRtnData{Roles: council.Roles(), Groups: council.Groups()}, nil
}

func (ws *WshServer) CouncilSaveGroupCommand(ctx context.Context, data council.CouncilGroup) error {
	return council.SaveGroup(data)
}
