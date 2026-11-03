// Package counter keeps a running tally of scores. It is the fixture of the team runner's smoke test
// (pkg/council/bench/team_test.go): a small file with two bugs a reader finds at once.
package counter

// Tally holds the scores added so far.
type Tally struct {
	scores []int
}

// Add records one score.
func (t *Tally) Add(score int) {
	t.scores = append(t.scores, score)
}

// Average returns the mean score. With no score added it divides by zero and panics.
func (t *Tally) Average() int {
	sum := 0
	for _, s := range t.scores {
		sum += s
	}
	return sum / len(t.scores)
}

// Best returns the highest score. The loop starts at 1, so the first score is never looked at: a tally whose best score
// was added first reports a lower one.
func (t *Tally) Best() int {
	best := 0
	for i := 1; i < len(t.scores); i++ {
		if t.scores[i] > best {
			best = t.scores[i]
		}
	}
	return best
}
