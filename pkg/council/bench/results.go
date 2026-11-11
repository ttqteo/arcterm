// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// ResultsFile is the results file under the data dir: one JSON object per line, append-only. A "run" line is one bench
// council scored; a "rating" line is a real council's Useful / Not really. A line of any other kind, and a line that is
// not JSON, is skipped on read, so a newer version's lines and a crash's half line never stop an older reader.
const ResultsFile = "council-bench.jsonl"

const (
	KindRun    = "run"
	KindRating = "rating"
)

const (
	RatingUseful = "useful"
	RatingNot    = "not"
)

// CouncilBenchResult is a "run" line: one bench council. Its scores mean something only when State is "done"; a failed
// or stopped council still gets its line (for its tokens and the count) with no recall, never a recall of 0 that would
// read as a bad score.
type CouncilBenchResult struct {
	Kind     string  `json:"kind"`
	Date     string  `json:"date"` // RFC 3339
	Harness  string  `json:"harness"`
	Case     string  `json:"case"`
	Variant  string  `json:"variant"`
	Run      int     `json:"run"`
	Council  string  `json:"council"`
	State    string  `json:"state"`
	Recall   int     `json:"recall"` // key lines matched in the items judged: the top items of a Review row, recall@all (every item) of a Brainstorm row from harness 2026-11-12.1 on
	Keys     int     `json:"keys"`   // the case's key lines: the denominator of recall
	Wrong    int     `json:"wrong"`  // report items the judge called wrong
	Tokens   int64   `json:"tokens"`
	Minutes  float64 `json:"minutes"`
	Messages int     `json:"messages"`

	JudgeTokens int64 `json:"judgetokens,omitempty"` // the judge's call, apart from Tokens: the bench's cap counts both

	// A Brainstorm row from harness 2026-11-12.1 on also has these two, apart from Recall: Recall3 is the key lines
	// matched at rank 1 to 3 of the one list the judge was shown, and Judged the items in that list, the denominator of
	// Wrong. Both are 0 on any other row.
	Recall3 int `json:"recall3,omitempty"`
	Judged  int `json:"judged,omitempty"`

	// Kept is the Brainstorm key lines matched among the wild ideas kept aside, outside recall, and KeptMatches the same
	// as key line id -> rank among them. Only a row of a harness before 2026-11-12.1 carries them (those judged the
	// wild ideas apart); no row written since sets them, and they stay so that an earlier row reads back whole.
	Kept        int            `json:"kept,omitempty"`
	KeptMatches map[string]int `json:"keptmatches,omitempty"`

	// Matches is which key lines the judge matched in the items it was shown: key line id -> its rank among them (1 is
	// the first). It is nil on a row written before it existed, and on a row with no match.
	Matches map[string]int `json:"matches,omitempty"`

	// Mode is the case's mode (council.ModeReview or council.ModeBrainstorm), so a table can split rows by it; a line
	// written before the field existed has none. The rest are a brainstorm row's, and empty on any other variant's:
	// Skill is which skill text ran (the first 8 hex of its SKILL.md's sha256 and the superpowers version), Decisions
	// the decision parts of the final design (Recall, Matches and Wrong are its final mark), RecallDone and MatchesDone
	// the same score at the done mark, before the builder check, and Questions the questions the person answered.
	Mode        string         `json:"mode,omitempty"`
	Skill       string         `json:"skill,omitempty"`
	Decisions   int            `json:"decisions,omitempty"`
	RecallDone  int            `json:"recall_done,omitempty"`
	MatchesDone map[string]int `json:"matches_done,omitempty"`
	Questions   int            `json:"questions,omitempty"`
}

// CouncilBenchRating is a "rating" line: the person's verdict on one real council's report.
type CouncilBenchRating struct {
	Kind    string `json:"kind"`
	RatedAt string `json:"ratedat"` // RFC 3339
	Harness string `json:"harness"`
	Mode    string `json:"mode"`
	Council string `json:"council"`
	Rating  string `json:"rating"` // RatingUseful or RatingNot
}

// ResultsPath is the results file under a data dir.
func ResultsPath(dataDir string) string { return filepath.Join(dataDir, ResultsFile) }

// fileMu serializes this process's appends and reads. A wavesrv holds the one writer.
var fileMu sync.Mutex

func stamp() string { return time.Now().UTC().Format(time.RFC3339) }

// AppendResult adds a run line. The kind is always "run", and an empty Date is now.
func AppendResult(dataDir string, r CouncilBenchResult) error {
	r.Kind = KindRun
	if r.Date == "" {
		r.Date = stamp()
	}
	return appendLine(dataDir, r)
}

// AppendRating adds a rating line. The kind is always "rating", and an empty RatedAt is now. A rating other than
// useful or not, or one with no council, is refused: reading would skip it, so writing it would only lose it.
func AppendRating(dataDir string, r CouncilBenchRating) error {
	if r.Rating != RatingUseful && r.Rating != RatingNot {
		return fmt.Errorf("rating %q is not %q or %q", r.Rating, RatingUseful, RatingNot)
	}
	if r.Council == "" {
		return errors.New("a rating needs the council it is for")
	}
	r.Kind = KindRating
	if r.RatedAt == "" {
		r.RatedAt = stamp()
	}
	return appendLine(dataDir, r)
}

// appendLine writes v as one line. A file whose last line a crash left without its newline gets one first, so the new
// line does not join the torn one.
func appendLine(dataDir string, v any) error {
	line, err := json.Marshal(v)
	if err != nil {
		return err
	}
	line = append(line, '\n')

	fileMu.Lock()
	defer fileMu.Unlock()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(ResultsPath(dataDir), os.O_APPEND|os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return err
	}
	if st, err := f.Stat(); err == nil && st.Size() > 0 {
		var last [1]byte
		if _, err := f.ReadAt(last[:], st.Size()-1); err == nil && last[0] != '\n' {
			line = append([]byte{'\n'}, line...)
		}
	}
	_, werr := f.Write(line)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	return werr
}

// LoadResults reads the file back: the run lines and the rating lines, each in file order. A missing file is no lines.
// A line of an unknown kind, one that is not JSON, and a rating that is not useful or not (or has no council) are
// skipped.
func LoadResults(dataDir string) ([]CouncilBenchResult, []CouncilBenchRating, error) {
	fileMu.Lock()
	data, err := os.ReadFile(ResultsPath(dataDir))
	fileMu.Unlock()
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	var runs []CouncilBenchResult
	var ratings []CouncilBenchRating
	for line := range strings.SplitSeq(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var head struct {
			Kind string `json:"kind"`
		}
		if json.Unmarshal([]byte(line), &head) != nil {
			continue
		}
		switch head.Kind {
		case KindRun:
			var r CouncilBenchResult
			if json.Unmarshal([]byte(line), &r) == nil {
				runs = append(runs, r)
			}
		case KindRating:
			var r CouncilBenchRating
			if json.Unmarshal([]byte(line), &r) == nil && validRating(r) {
				ratings = append(ratings, r)
			}
		}
	}
	return runs, ratings, nil
}

func validRating(r CouncilBenchRating) bool {
	return r.Council != "" && (r.Rating == RatingUseful || r.Rating == RatingNot)
}

// CouncilBenchRow is the table's row for one harness version, mode, variant and skill text. The scores count only the
// runs that ended done (Scored), so a failed or stopped run lowers neither the recall nor the denominator it is read
// against; its tokens are real spend and stay in.
type CouncilBenchRow struct {
	Harness string `json:"harness"`
	// Mode is the mode of the cases the row's runs were on (council.ModeReview or council.ModeBrainstorm); empty when a
	// run's line has none and its case is no longer in cases.json.
	Mode       string  `json:"mode"`
	Variant    string  `json:"variant"`
	Skill      string  `json:"skill,omitempty"` // a brainstorm row's skill text: two never add up in one row
	Runs       int     `json:"runs"`            // every run, failed and stopped ones too
	Scored     int     `json:"scored"`          // the runs that ended done
	Recall     int     `json:"recall"`          // key lines matched in the items judged, summed over the scored runs
	Keys       int     `json:"keys"`            // the key lines those runs were scored against
	Kept       int     `json:"kept"`            // key lines matched among wild ideas kept aside: only runs of a harness before 2026-11-12.1 have any
	Wrong      int     `json:"wrong"`
	Tokens     int64   `json:"tokens"`     // of every run
	RecallPerM float64 `json:"recallperm"` // Recall per million tokens

	// A brainstorm row's, each summed over the scored runs, and zero on any other variant's: Recall3 is the key lines
	// matched at rank 1 to 3 of the list judged (Recall is recall@all), Judged the items in those lists, the
	// denominator of Wrong (0 on a run of a harness before 2026-11-12.1, which had no such count), RecallDone the recall
	// at the done mark (Recall is the final mark's), Decisions the decision parts of the final designs, Questions the
	// questions the person answered.
	Recall3    int `json:"recall3"`
	Judged     int `json:"judged"`
	RecallDone int `json:"recall_done,omitempty"`
	Decisions  int `json:"decisions,omitempty"`
	Questions  int `json:"questions,omitempty"`
}

// Summarize groups the runs by harness version, mode, variant and skill text, the newest harness first (within it
// review, then brainstorm, then any other mode; within a mode solo, council, team, then brainstorm), so one version's
// score is never read as another's and a council on a Review case is never added to one on a Brainstorm case. A run's
// mode is its own, else its case's in modes (the case id -> mode map of cases.json, nil when it cannot be read), else
// empty.
func Summarize(results []CouncilBenchResult, modes map[string]string) []CouncilBenchRow {
	type groupKey struct{ harness, mode, variant, skill string }
	index := map[groupKey]int{}
	var rows []CouncilBenchRow
	for _, r := range results {
		mode := r.Mode
		if mode == "" {
			mode = modes[r.Case]
		}
		k := groupKey{r.Harness, mode, r.Variant, r.Skill}
		i, ok := index[k]
		if !ok {
			i = len(rows)
			index[k] = i
			rows = append(rows, CouncilBenchRow{Harness: r.Harness, Mode: mode, Variant: r.Variant, Skill: r.Skill})
		}
		row := &rows[i]
		row.Runs++
		row.Tokens += r.Tokens
		if r.State != string(council.StateDone) {
			continue
		}
		row.Scored++
		row.Recall += r.Recall
		row.Keys += r.Keys
		row.Kept += r.Kept
		row.Recall3 += r.Recall3
		row.Judged += r.Judged
		row.Wrong += r.Wrong
		row.RecallDone += r.RecallDone
		row.Decisions += r.Decisions
		row.Questions += r.Questions
	}
	for i := range rows {
		if rows[i].Tokens > 0 {
			rows[i].RecallPerM = float64(rows[i].Recall) / (float64(rows[i].Tokens) / 1e6)
		}
	}
	slices.SortStableFunc(rows, func(a, b CouncilBenchRow) int {
		if c := compareHarness(b.Harness, a.Harness); c != 0 {
			return c
		}
		if c := compareMode(a.Mode, b.Mode); c != 0 {
			return c
		}
		if c := compareVariant(a.Variant, b.Variant); c != 0 {
			return c
		}
		return strings.Compare(a.Skill, b.Skill)
	})
	return rows
}

// compareMode orders review, then brainstorm, then any other named mode by name, then no mode (a line whose case is
// gone) last.
func compareMode(a, b string) int {
	rank := func(m string) int {
		switch m {
		case council.ModeReview:
			return 0
		case council.ModeBrainstorm:
			return 1
		case "":
			return 3
		}
		return 2
	}
	if c := cmp.Compare(rank(a), rank(b)); c != 0 {
		return c
	}
	return strings.Compare(a, b)
}

// CouncilBenchRatingRow is the ratings' row for one harness version and mode.
type CouncilBenchRatingRow struct {
	Harness string `json:"harness"`
	Mode    string `json:"mode"`
	Useful  int    `json:"useful"`
	Not     int    `json:"not"`
}

// SummarizeRatings counts the ratings per harness version and mode, the newest harness first. A council rated more
// than once counts once, by its latest line (the later RatedAt; a tie, or a time that does not parse, goes to the
// later line in the file). The earlier lines stay in the file.
func SummarizeRatings(ratings []CouncilBenchRating) []CouncilBenchRatingRow {
	latest := map[string]CouncilBenchRating{}
	for _, r := range ratings {
		if !validRating(r) {
			continue
		}
		if prev, ok := latest[r.Council]; ok && ratedBefore(r, prev) {
			continue
		}
		latest[r.Council] = r
	}

	type groupKey struct{ harness, mode string }
	index := map[groupKey]int{}
	var rows []CouncilBenchRatingRow
	for _, r := range latest {
		mode := r.Mode
		if mode == "" {
			mode = council.ModeReview
		}
		k := groupKey{r.Harness, mode}
		i, ok := index[k]
		if !ok {
			i = len(rows)
			index[k] = i
			rows = append(rows, CouncilBenchRatingRow{Harness: r.Harness, Mode: mode})
		}
		if r.Rating == RatingUseful {
			rows[i].Useful++
		} else {
			rows[i].Not++
		}
	}
	slices.SortFunc(rows, func(a, b CouncilBenchRatingRow) int {
		if c := compareHarness(b.Harness, a.Harness); c != 0 {
			return c
		}
		return strings.Compare(a.Mode, b.Mode)
	})
	return rows
}

// ratedBefore says a was given before b, by their times; two times that do not both parse are not ordered.
func ratedBefore(a, b CouncilBenchRating) bool {
	at, aerr := time.Parse(time.RFC3339, a.RatedAt)
	bt, berr := time.Parse(time.RFC3339, b.RatedAt)
	return aerr == nil && berr == nil && at.Before(bt)
}

// compareHarness orders harness versions (<YYYY-MM-DD>.<n>) oldest first: by date, then by the counter as a number
// (.10 follows .9), and a council with no harness version is older than any.
func compareHarness(a, b string) int {
	ad, an := splitHarness(a)
	bd, bn := splitHarness(b)
	if c := strings.Compare(ad, bd); c != 0 {
		return c
	}
	if c := cmp.Compare(an, bn); c != 0 {
		return c
	}
	return strings.Compare(a, b)
}

func splitHarness(h string) (date string, n int) {
	date, count, _ := strings.Cut(h, ".")
	n, _ = strconv.Atoi(count)
	return date, n
}

// compareVariant orders the known variants solo, council, team, brainstorm (variantOrder), then any other by name.
func compareVariant(a, b string) int {
	rank := func(v string) int {
		if i := slices.Index(variantOrder, v); i >= 0 {
			return i
		}
		return len(variantOrder)
	}
	if c := cmp.Compare(rank(a), rank(b)); c != 0 {
		return c
	}
	return strings.Compare(a, b)
}
