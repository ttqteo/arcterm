// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
)

// ModelZones is the model behind a Brainstorm's zone call: one no-tools haiku call over the question and the panel.
const ModelZones = "haiku"

// zonesId is the id the zone call goes out under; its tokens are booked on the council and on the coordinator's row.
const zonesId = "zones"

// zonesOpening opens the zone call's prompt.
const zonesOpening = "You split the question of a council that brainstorms into zones, one for each seat of its panel."

// zonesShape is the zone call's answer: one entry per panel seat.
const zonesShape = `{
  "zones": [
    {"seat": "ux", "name": "First launch", "covers": "one sentence on the part of the feature it covers"}
  ]
}`

// hasZones says c is a Brainstorm that holds zones, so its round 1 and its synthesis read them.
func hasZones(c *Council) bool { return isBrainstorm(c) && len(c.Zones) > 0 }

// zoneOf is seat id's zone in c, if it has one.
func zoneOf(c *Council, id string) (CouncilZone, bool) {
	for _, z := range c.Zones {
		if z.Seat == id {
			return z, true
		}
	}
	return CouncilZone{}, false
}

// zoneNamed is the stored zone name that name matches, ignoring case and the spaces around it; empty when c holds no
// zones, or none matches.
func zoneNamed(c *Council, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	for _, z := range c.Zones {
		if strings.EqualFold(z.Name, name) {
			return z.Name
		}
	}
	return ""
}

// zonesPrompt asks for one zone per panel seat, read from the question: the feature, the question, the attached paths
// by name only, and each seat's angle.
func zonesPrompt(c *Council) string {
	var b strings.Builder
	b.WriteString(zonesOpening + " A zone is the part of the problem one seat explores in the ideas round, so the " +
		"seats spread over the problem instead of each sweeping all of it.\n\n")
	fmt.Fprintf(&b, "Problem or goal: %s\n", c.Feature)
	if q := strings.TrimSpace(c.Question); q != "" {
		fmt.Fprintf(&b, "Question for the council: %s\n", q)
	}
	if paths := append(append([]string{}, c.Files...), c.Screenshots...); len(paths) > 0 {
		b.WriteString("\nThe person attached these files and folders (by name only; you have no tools to open them):\n")
		for _, f := range paths {
			fmt.Fprintf(&b, "- %s\n", f)
		}
	}
	b.WriteString("\n## The seats\n\n")
	for _, e := range panelOf(c) {
		if angle := angleOf(e.Brief); angle != "" {
			fmt.Fprintf(&b, "- %s (%s): %s\n", e.Id, e.Name, angle)
		} else {
			fmt.Fprintf(&b, "- %s (%s)\n", e.Id, e.Name)
		}
	}
	b.WriteString("\n## What to do\n\n")
	b.WriteString("Read the zones from the question itself, not from a fixed list: a user journey, a part of the " +
		"feature, or whatever splits this question best. Give one zone for each seat above, no two alike, and match " +
		"each zone to the seat whose angle fits it best. A zone has a \"name\" of a few words and a \"covers\" line: " +
		"one sentence on the part of the feature it covers. \"seat\" is the seat's id.\n\n")
	if c.Lang == LangVi {
		b.WriteString("The person writes in Vietnamese, so write each zone's \"name\" and \"covers\" in Vietnamese too.\n\n")
	}
	b.WriteString(jsonRule + "\n```json\n" + zonesShape + "\n```\n")
	return b.String()
}

// parseZones reads the zone call's reply into one zone per panel seat, in panel order. An entry for a seat not on the
// panel, a second entry for a seat and an entry with no name are dropped; a panel seat left with no zone fails it all.
func parseZones(reply string, panel []CouncilExpert) ([]CouncilZone, error) {
	const what = "zones"
	var raw struct {
		Zones *[]struct {
			Seat   string `json:"seat"`
			Name   string `json:"name"`
			Covers string `json:"covers"`
		} `json:"zones"`
	}
	if err := decodeReply(reply, what, &raw); err != nil {
		return nil, err
	}
	if raw.Zones == nil {
		return nil, fmt.Errorf("%s reply has no zones field", what)
	}
	onPanel := map[string]bool{}
	for _, e := range panel {
		onPanel[e.Id] = true
	}
	bySeat := map[string]CouncilZone{}
	for _, z := range *raw.Zones {
		zone := CouncilZone{Seat: strings.TrimSpace(z.Seat), Name: strings.TrimSpace(z.Name), Covers: strings.TrimSpace(z.Covers)}
		if _, seen := bySeat[zone.Seat]; !onPanel[zone.Seat] || seen || zone.Name == "" {
			continue
		}
		bySeat[zone.Seat] = zone
	}
	if len(panel) == 0 {
		return nil, errors.New("the panel has no seat to zone")
	}
	out := make([]CouncilZone, 0, len(panel))
	var missing []string
	for _, e := range panel {
		z, ok := bySeat[e.Id]
		if !ok {
			missing = append(missing, e.Id)
			continue
		}
		out = append(out, z)
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("%s reply has no zone for %s", what, strings.Join(missing, ", "))
	}
	return out, nil
}

// setZones makes the zone call for council id before round 1 and saves the zones it reads. The call is booked on the
// council and on the coordinator's row whatever it returned. A failed call, an empty reply or one that does not read is
// logged and leaves the council with no zones: round 1 then runs as it does without them, and the council does not fail.
func (r *Runner) setZones(ctx context.Context, rn *run, id string, snap *Council) {
	if r.Caller == nil {
		return
	}
	zoner := CouncilExpert{Id: zonesId, Name: "Zones", Model: ModelZones}
	res, err := r.Caller.Call(ctx, CallReq{Expert: zoner, Cwd: snap.Project, Tools: false, Prompt: zonesPrompt(snap)})
	if err != nil && ctx.Err() != nil {
		return // stopped: nothing to save
	}
	var zones []CouncilZone
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		zones, err = parseZones(res.Text, panelOf(snap))
	}
	if err != nil {
		log.Printf("[council] %s: no zones: %v", id, err)
	}
	r.updateLogged(rn, id, func(c *Council) error {
		c.Calls++
		c.Tokens += res.Tokens
		if coord, ok := coordinatorExpert(c); ok {
			st := c.Stats[coord.Id]
			st.Calls++
			st.Tokens += res.Tokens
			setStat(c, coord.Id, st)
		}
		if len(zones) > 0 && len(c.Zones) == 0 {
			c.Zones = zones
		}
		return nil
	})
}
