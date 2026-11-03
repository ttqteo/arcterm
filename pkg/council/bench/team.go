// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// The states a team cell ends in. A team has no council to carry a state, so its outcome names one: done is a report
// that was parsed and can be judged, failed anything else that went wrong, timed-out a lead that outlived its limit.
const (
	TeamDone     = "done"
	TeamFailed   = "failed"
	TeamTimedOut = "timed-out"
)

// TeamOutcome is how one team cell ended: the lead's session, its state, the report it wrote parsed into a summary (set
// only for a done outcome), and the spend, wall time and SendMessage count that become the cell's row.
type TeamOutcome struct {
	Session  string
	State    string
	Summary  *council.CouncilSummary
	Tokens   int64
	Minutes  float64
	Messages int
}

// TeamOptions are the models and the wall-time limit of a team cell.
type TeamOptions struct {
	Lead  string
	Mate  string
	Limit time.Duration
}

// DefaultTeamOptions are what the bench runs a team with: the council's own seats, an opus lead and sonnet teammates.
var DefaultTeamOptions = TeamOptions{Lead: "opus", Mate: "sonnet", Limit: 45 * time.Minute}

// TeamFunc runs one case as a team and says how it ended. Its error is ctx's only, as runItem's is: any other failure
// is an outcome whose state is TeamFailed.
type TeamFunc func(ctx context.Context, c Case) (TeamOutcome, error)

// RunTeam is the real TeamFunc. The team runner is not built yet: it ends every cell failed.
func RunTeam(ctx context.Context, c Case) (TeamOutcome, error) {
	log.Printf("[council-bench] case %s: the team runner is not built yet", c.Id)
	return TeamOutcome{State: TeamFailed}, nil
}
