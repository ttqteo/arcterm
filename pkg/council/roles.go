// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	ModelExpert      = "sonnet"
	ModelCoordinator = "opus"

	// evidenceRule ends every brief: what counts as evidence, and what happens to a claim without any.
	evidenceRule = "Cite a path:line for every claim, or a region of an attached screenshot; a claim with neither is marked weak."
)

func brief(angle string) string { return angle + " " + evidenceRule }

// builtInRoles is the library that ships. councilroles.json overrides a role by id and adds its own.
var builtInRoles = []CouncilExpert{
	{
		Id: "ux", Name: "UX", Model: ModelExpert,
		Brief: brief("You review the feature as the UX expert. Ask whether someone can find, read and use it without being " +
			"told how: where its entry point is, what the first screen tells them, whether a label, a state or an error " +
			"can be understood at a glance, and what the keyboard or a narrow window does to it. Propose concrete " +
			"changes to what is on screen, not general principles."),
	},
	{
		Id: "ram", Name: "RAM", Model: ModelExpert,
		Brief: brief("You review the feature for memory. Ask what stays in memory, for how long, and whether it is logged in " +
			"RAM watch (docs/open-issues.md): caches, per-agent or per-terminal state, event subscriptions, timers, " +
			"retained transcripts, views that stay mounted. Name what owns each allocation and when it is released, and " +
			"say what you would measure and how."),
	},
	{
		Id: "newuser", Name: "New user", Model: ModelExpert,
		Brief: brief("You are on your first day in arcterm and know none of its names, panes or shortcuts. Ask what is " +
			"confusing and what is missing, and where you would give up. Read the feature's words as you would meet " +
			"them in the app, and say where a term, an icon or a step assumes something you have not been told."),
	},
	{
		Id: "skeptic", Name: "Skeptic", Model: ModelExpert,
		Brief: brief("You are the skeptic. Name what breaks: the input nobody tried, the state two features reach at " +
			"once, the failure the design leaves unhandled, the claim another expert made without checking it. If you " +
			"cannot name a break, withdraw your proposal rather than pad it. Make no claim without evidence."),
	},
	{
		Id: "coordinator", Name: "Coordinator", Model: ModelCoordinator, Coordinator: true,
		Brief: brief("You are the coordinator. Merge the proposals that say the same thing, rank the directions that remain " +
			"by what they are worth for the effort, attach each expert's stance to each direction, and mark the claims " +
			"that cite nothing as weak. Name any role the panel was missing. Add no proposals of your own."),
	},
	{
		Id: "reviewer-a", Name: "Reviewer A", Model: ModelExpert,
		Brief: brief("You are a reviewer at the venue's security bar (CCS, NDSS). Judge novelty against prior work, whether " +
			"the threat model is stated and the attacker realistic, and whether each claim is sound given the evidence " +
			"in the paper. Say what would make you reject it and what would change your mind."),
	},
	{
		Id: "reviewer-b", Name: "Reviewer B", Model: ModelExpert,
		Brief: brief("You are a reviewer who checks baselines and datasets. For every claim, ask whether it is tested on " +
			"prior work's own data, whether the baselines are the strongest available and run fairly, and whether the " +
			"numbers in the text match the tables. Name the comparison that is missing."),
	},
	{
		Id: "reader", Name: "Reader", Model: ModelExpert,
		Brief: brief(`You read the prose only, not the method. Find terms used before they are defined, dense "not X but Y" ` +
			"sentences, and sentences that read as machine-written. Quote each, cite the .tex line, and propose a " +
			"plainer sentence."),
	},
	{
		Id: "areachair", Name: "Area chair", Model: ModelCoordinator, Coordinator: true,
		Brief: brief("You are the area chair, the coordinator of a paper review. Merge the reviews into what to fix before " +
			"submission, ranked by how likely each point is to sink the paper. Merge duplicate points, mark a claim " +
			"weak when it cites nothing, and say which concerns the text can answer and which need new work."),
	},
}

// builtInGroups are the two groups that ship.
var builtInGroups = []CouncilGroup{
	{Id: "ui-feature", Name: "Review a UI feature", Roles: []string{"ux", "ram", "newuser", "skeptic"}, Coordinator: "coordinator"},
	{Id: "paper", Name: "Paper review", Roles: []string{"reviewer-a", "reviewer-b", "reader"}, Coordinator: "areachair"},
}

// userRoles reads councilroles.json; a file that does not parse leaves the built-ins alone, and says so in the log.
func userRoles() wconfig.CouncilRolesConfig {
	cfg, err := wconfig.ReadCouncilRoles()
	if err != nil {
		log.Printf("[council] %s ignored: %v", wconfig.CouncilRolesFile, err)
		return wconfig.CouncilRolesConfig{}
	}
	return cfg
}

// Roles is the role library: the built-ins in order, each with the person's overrides from councilroles.json, then
// the roles the file adds. A field the file leaves empty keeps the built-in's; an added role with no model gets sonnet.
func Roles() []CouncilExpert {
	roles := make([]CouncilExpert, len(builtInRoles))
	copy(roles, builtInRoles)
	index := make(map[string]int, len(roles))
	for i, r := range roles {
		index[r.Id] = i
	}
	for _, u := range userRoles().Roles {
		id := strings.TrimSpace(u.Id)
		if id == "" {
			continue
		}
		i, ok := index[id]
		if !ok {
			roles = append(roles, CouncilExpert{Id: id, Name: id, Model: ModelExpert})
			i = len(roles) - 1
			index[id] = i
		}
		if u.Name != "" {
			roles[i].Name = u.Name
		}
		if u.Brief != "" {
			roles[i].Brief = u.Brief
		}
		if u.Model != "" {
			roles[i].Model = u.Model
		}
	}
	return roles
}

// Groups lists the built-in groups, then the person's. A group in councilroles.json of a built-in's id replaces it.
func Groups() []CouncilGroup {
	groups := make([]CouncilGroup, 0, len(builtInGroups))
	index := map[string]int{}
	add := func(g CouncilGroup) {
		g.Roles = append([]string{}, g.Roles...)
		if i, ok := index[g.Id]; ok {
			groups[i] = g
			return
		}
		index[g.Id] = len(groups)
		groups = append(groups, g)
	}
	for _, g := range builtInGroups {
		add(g)
	}
	for _, u := range userRoles().Groups {
		if strings.TrimSpace(u.Id) == "" {
			continue
		}
		name := u.Name
		if name == "" {
			name = u.Id
		}
		add(CouncilGroup{Id: u.Id, Name: name, Roles: u.Roles, Coordinator: u.Coordinator})
	}
	return groups
}

// ExpertsFor is the panel of a group: its roles in order, a role id that is unknown or repeated left out, and the
// coordinator last. A group whose coordinator is not a known role cannot run, so it is an error.
func ExpertsFor(groupId string) ([]CouncilExpert, error) {
	var group *CouncilGroup
	groups := Groups()
	for i := range groups {
		if groups[i].Id == groupId {
			group = &groups[i]
			break
		}
	}
	if group == nil {
		return nil, fmt.Errorf("council: no group %q", groupId)
	}
	byId := map[string]CouncilExpert{}
	for _, r := range Roles() {
		byId[r.Id] = r
	}
	coordinator, ok := byId[group.Coordinator]
	if !ok {
		return nil, fmt.Errorf("council: group %q has no coordinator: %q is not a known role", group.Id, group.Coordinator)
	}
	seen := map[string]bool{coordinator.Id: true}
	experts := make([]CouncilExpert, 0, len(group.Roles)+1)
	for _, id := range group.Roles {
		r, ok := byId[id]
		if !ok || seen[id] {
			continue
		}
		seen[id] = true
		r.Coordinator = false
		experts = append(experts, r)
	}
	coordinator.Coordinator = true
	return append(experts, coordinator), nil
}

// SaveGroup keeps a group in councilroles.json, replacing one of its id.
func SaveGroup(g CouncilGroup) error {
	id := strings.TrimSpace(g.Id)
	if id == "" {
		return fmt.Errorf("council: a group needs an id")
	}
	roles := g.Roles
	if roles == nil {
		roles = []string{}
	}
	return wconfig.SetUserCouncilGroup(wconfig.CouncilGroupConfig{Id: id, Name: g.Name, Roles: roles, Coordinator: g.Coordinator})
}
