// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var runsRouteCmd = &cobra.Command{
	Use:   "route",
	Short: "show or save the routes a new run defaults to (lead, workers, reviewers)",
	Long: `Show the routes a new run in this project defaults to, or save the workers default.

With no flags it prints the lead route 'wsh runs start' would use, the workers setting and the reviewer
route, each with where it comes from. With a workers flag it saves that default for this project, or for
every project with --global, as the cockpit's run settings do. A project's own setting wins over the
global one. 'wsh runs start --worker-runtime/--worker-model/--reviewer-picks' still overrides both for
one run.`,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE:    runsRouteRun,
}

func init() {
	f := runsRouteCmd.Flags()
	f.String("worker-runtime", "", "save this worker harness as the default (claude|pi)")
	f.String("worker-model", "", "save this worker model as the default, e.g. sonnet (needs --worker-runtime)")
	f.Bool("reviewer-picks", false, "save Reviewer picks as the default: the plan reviewer picks each task's model")
	f.Bool("same-as-lead", false, "save Same as lead as the default: workers run on the lead's route")
	f.Bool("global", false, "save for every project instead of this one")
	f.String("project", "", "project directory (default: the current directory)")
	f.String("channel", "", "channel id, instead of resolving the project")
	f.Bool("json", false, "JSON output")
	runsCmd.AddCommand(runsRouteCmd)
}

type runsRouteOpts struct {
	workerRuntime, workerModel string
	reviewerPicks, sameAsLead  bool
}

func (o runsRouteOpts) any() bool {
	return o.workerRuntime != "" || o.workerModel != "" || o.reviewerPicks || o.sameAsLead
}

// runsWorkersSetting turns the flags into the one workers setting they name: a route, Reviewer picks, or
// Same as lead (nil route, no picks).
func runsWorkersSetting(o runsRouteOpts) (*waveobj.RoutePin, bool, error) {
	n := 0
	if o.workerRuntime != "" || o.workerModel != "" {
		n++
	}
	if o.reviewerPicks {
		n++
	}
	if o.sameAsLead {
		n++
	}
	switch {
	case n == 0:
		return nil, false, fmt.Errorf("nothing to save: pass --worker-runtime/--worker-model, --reviewer-picks or --same-as-lead")
	case n > 1:
		return nil, false, fmt.Errorf("--worker-runtime/--worker-model, --reviewer-picks and --same-as-lead are one setting; pass one")
	case o.workerModel != "" && o.workerRuntime == "":
		return nil, false, fmt.Errorf("--worker-model needs --worker-runtime")
	case o.workerRuntime != "":
		return &waveobj.RoutePin{Runtime: o.workerRuntime, Model: o.workerModel}, false, nil
	}
	return nil, o.reviewerPicks, nil
}

func applyGlobalWorkers(p waveobj.JarvisProfile, route *waveobj.RoutePin, picks bool) waveobj.JarvisProfile {
	p.WorkerRoute, p.ReviewerPicks = route, picks
	return p
}

// applyOverrideWorkers sets the override's workers section. Both fields are written: a non-nil
// ReviewerPicks is what makes the section the project's own instead of inherited.
func applyOverrideWorkers(o *waveobj.ProfileOverride, route *waveobj.RoutePin, picks bool) *waveobj.ProfileOverride {
	out := waveobj.ProfileOverride{}
	if o != nil {
		out = *o
	}
	out.WorkerRoute, out.ReviewerPicks = route, &picks
	return &out
}

func describeRoute(r *waveobj.RoutePin) string {
	if r == nil || r.Runtime == "" {
		return ""
	}
	if r.Model == "" {
		return r.Runtime + " / (harness default model)"
	}
	return r.Runtime + " / " + r.Model
}

func describeWorkers(route *waveobj.RoutePin, picks bool) string {
	if picks {
		return "reviewer picks each task's model"
	}
	if d := describeRoute(route); d != "" {
		return d
	}
	return "same as lead"
}

func runsRouteRun(cmd *cobra.Command, args []string) error {
	flag := func(name string) string { v, _ := cmd.Flags().GetString(name); return v }
	boolFlag := func(name string) bool { v, _ := cmd.Flags().GetBool(name); return v }
	o := runsRouteOpts{workerRuntime: flag("worker-runtime"), workerModel: flag("worker-model"),
		reviewerPicks: boolFlag("reviewer-picks"), sameAsLead: boolFlag("same-as-lead")}
	global := boolFlag("global")
	if o.any() {
		route, picks, err := runsWorkersSetting(o)
		if err != nil {
			return err
		}
		if global {
			if err := runsSaveGlobalWorkers(route, picks); err != nil {
				return err
			}
			fmt.Printf("saved for every project: workers %s\n", describeWorkers(route, picks))
		} else {
			ch, err := runsChannel(cmd, true)
			if err != nil {
				return err
			}
			if err := runsSaveProjectWorkers(ch.OID, route, picks); err != nil {
				return err
			}
			fmt.Printf("saved for %s: workers %s\n", ch.Name, describeWorkers(route, picks))
		}
	} else if global {
		return fmt.Errorf("--global saves a setting: pass --worker-runtime/--worker-model, --reviewer-picks or --same-as-lead")
	}
	return runsRoutePrint(cmd)
}

func runsSaveGlobalWorkers(route *waveobj.RoutePin, picks bool) error {
	g, err := wshclient.GetGlobalProfileCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return fmt.Errorf("reading the global profile: %w", err)
	}
	next := applyGlobalWorkers(*g, route, picks)
	if err := wshclient.SetGlobalProfileCommand(RpcClient, wshrpc.CommandSetGlobalProfileData{Profile: next}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs}); err != nil {
		return fmt.Errorf("saving the global profile: %w", err)
	}
	return nil
}

func runsSaveProjectWorkers(channelId string, route *waveobj.RoutePin, picks bool) error {
	prof, err := wshclient.GetJarvisProfileCommand(RpcClient, wshrpc.CommandGetJarvisProfileData{ChannelId: channelId}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return fmt.Errorf("reading the project's profile: %w", err)
	}
	data := wshrpc.CommandSetChannelProfileData{ChannelId: channelId, Override: applyOverrideWorkers(prof.Override, route, picks)}
	if err := wshclient.SetChannelProfileCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs}); err != nil {
		return fmt.Errorf("saving the project's profile: %w", err)
	}
	return nil
}

type runsRouteView struct {
	Project       string `json:"project"`
	Lead          string `json:"lead"`
	Workers       string `json:"workers"`
	WorkersFrom   string `json:"workersfrom"` // project | global
	Reviewers     string `json:"reviewers"`
	ReviewersFrom string `json:"reviewersfrom"` // project | global | lead
}

func runsRoutePrint(cmd *cobra.Command) error {
	ch, err := runsChannel(cmd, true)
	if err != nil {
		return err
	}
	prof, err := wshclient.GetJarvisProfileCommand(RpcClient, wshrpc.CommandGetJarvisProfileData{ChannelId: ch.OID}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return fmt.Errorf("reading the project's profile: %w", err)
	}
	v := runsRouteView{Project: ch.Name, WorkersFrom: "global", ReviewersFrom: "global"}
	if lead, err := runsLeadRoute(ch.OID, "", ""); err != nil {
		v.Lead = err.Error()
	} else {
		v.Lead = describeRoute(&lead)
	}
	v.Workers = describeWorkers(prof.Resolved.WorkerRoute, prof.Resolved.ReviewerPicks)
	if prof.Override != nil && (prof.Override.WorkerRoute != nil || prof.Override.ReviewerPicks != nil) {
		v.WorkersFrom = "project"
	}
	v.Reviewers = describeRoute(prof.Resolved.ReviewerRoute)
	if prof.Override != nil && prof.Override.ReviewerRoute != nil {
		v.ReviewersFrom = "project"
	}
	if v.Reviewers == "" {
		v.Reviewers, v.ReviewersFrom = "same as lead", "lead"
	}
	if isJSON(cmd) {
		return jsonOut(v)
	}
	fmt.Printf("project    %s\n", v.Project)
	fmt.Printf("lead       %s\n", v.Lead)
	fmt.Printf("workers    %s  (%s)\n", v.Workers, v.WorkersFrom)
	fmt.Printf("reviewers  %s  (%s)\n", v.Reviewers, v.ReviewersFrom)
	return nil
}
