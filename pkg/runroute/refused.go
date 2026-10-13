// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runroute

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// RefusedRouteTTL is how long a refusal marks its route. A lapsed plan stays refused until someone acts, and the
// picker's refresh clears every mark at once after a renewal; the expiry only stops a mark outliving a fix that
// nobody refreshed after.
const RefusedRouteTTL = 7 * 24 * time.Hour

const refusedRoutesFile = "refused-routes.json"

// RefusedRoute is a route its provider refused (a 401 or 403): no session on it runs until the account changes.
type RefusedRoute struct {
	Runtime string `json:"runtime"`
	Model   string `json:"model,omitempty"` // "" for the runtime's own default
	Text    string `json:"text"`
	Ts      int64  `json:"ts"`
}

var refusedMu sync.Mutex

func refusedRoutesPath() string {
	return filepath.Join(wavebase.GetWaveDataDir(), refusedRoutesFile)
}

// RecordRefused marks routes refused, each replacing an earlier mark for the same route, and drops expired marks.
func RecordRefused(now int64, marks ...RefusedRoute) error {
	refusedMu.Lock()
	defer refusedMu.Unlock()
	routes := unexpired(readRefused(), now)
	for _, m := range marks {
		kept := routes[:0]
		for _, r := range routes {
			if r.Runtime != m.Runtime || r.Model != m.Model {
				kept = append(kept, r)
			}
		}
		routes = append(kept, m)
	}
	data, err := json.MarshalIndent(routes, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(refusedRoutesPath(), data, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", refusedRoutesFile, err)
	}
	return nil
}

// RefusedRoutes is every mark younger than RefusedRouteTTL.
func RefusedRoutes(now int64) []RefusedRoute {
	refusedMu.Lock()
	defer refusedMu.Unlock()
	return unexpired(readRefused(), now)
}

// ClearRefused drops every mark: the account behind a route may have changed.
func ClearRefused() error {
	refusedMu.Lock()
	defer refusedMu.Unlock()
	if err := os.Remove(refusedRoutesPath()); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("clearing %s: %w", refusedRoutesFile, err)
	}
	return nil
}

// readRefused reads the marks; a missing file is none, and an unreadable one is logged and read as none, since a
// lost mark only costs the picker a warning.
func readRefused() []RefusedRoute {
	data, err := os.ReadFile(refusedRoutesPath())
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("reading %s: %v", refusedRoutesFile, err)
		}
		return nil
	}
	var routes []RefusedRoute
	if err := json.Unmarshal(data, &routes); err != nil {
		log.Printf("parsing %s: %v", refusedRoutesFile, err)
		return nil
	}
	return routes
}

func unexpired(routes []RefusedRoute, now int64) []RefusedRoute {
	kept := routes[:0]
	for _, r := range routes {
		if now-r.Ts < RefusedRouteTTL.Milliseconds() {
			kept = append(kept, r)
		}
	}
	return kept
}
