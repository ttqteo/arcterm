// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// OthersMin is the least an image name's processes must hold together to be listed among the others: below it a
	// process is not what is filling the machine (Task Manager's own list starts at a few MB, which is noise here).
	OthersMin int64 = 200 << 20
	// the others listed at most, heaviest first
	othersLimit = 12
	// a snapshot that asked for the others keeps the sampler reading them for this long: the panel polls every 2 s
	othersHold = 6 * time.Second
)

// otherProc is one process outside arcterm and its agents, as one tick read it.
type otherProc struct {
	Pid  int
	Name string
	Cpu  float64
	Mem  int64
	Gpu  float64
}

// groupOthers sums the processes by image name (case aside, the first spelling seen names the group), keeps the
// groups holding at least min bytes, and lists at most limit of them, heaviest first, by name on a tie. A process
// whose memory could not be read (Mem < 0) counts in no group.
func groupOthers(procs []otherProc, min int64, limit int) []wshrpc.ResMonOther {
	byKey := map[string]*wshrpc.ResMonOther{}
	for _, p := range procs {
		if p.Mem < 0 || p.Name == "" {
			continue
		}
		key := strings.ToLower(p.Name)
		g, ok := byKey[key]
		if !ok {
			g = &wshrpc.ResMonOther{Name: p.Name, Endable: Endable(p.Name)}
			byKey[key] = g
		}
		g.Count++
		g.Mem += p.Mem
		if p.Cpu > 0 {
			g.Cpu += p.Cpu
		}
		g.Gpu = max(g.Gpu, p.Gpu)
	}
	out := make([]wshrpc.ResMonOther, 0, len(byKey))
	for _, g := range byKey {
		if g.Mem >= min {
			out = append(out, *g)
		}
	}
	slices.SortFunc(out, func(a, b wshrpc.ResMonOther) int {
		return cmp.Or(cmp.Compare(b.Mem, a.Mem), cmp.Compare(a.Name, b.Name))
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// iconCache holds each image name's icon (lowercased name → PNG data URL, "" for one that could not be read), read once
// per wavesrv: an image's icon does not change while it runs, and the names listed are a dozen at most. Only the
// sampler's goroutine touches it.
var iconCache = map[string]string{}

// iconReader reads a process's icon; a test swaps it
var iconReader = readIcon

// withIcons gives each listed group the icon of its image, from the first of its processes the icon reads from; a name
// tried before takes the cached answer, read or not.
func withIcons(groups []wshrpc.ResMonOther, procs []otherProc) {
	for i := range groups {
		key := strings.ToLower(groups[i].Name)
		icon, tried := iconCache[key]
		if !tried {
			for _, p := range procs {
				if p.Pid > 0 && strings.ToLower(p.Name) == key {
					if icon = iconReader(p.Pid); icon != "" {
						break
					}
				}
			}
			iconCache[key] = icon
		}
		groups[i].Icon = icon
	}
}

// AskOthers has the sampler read the processes outside arcterm too, from its next tick until othersHold passes
// with no other ask. Snapshot then carries them.
func AskOthers() {
	sampler.mu.Lock()
	defer sampler.mu.Unlock()
	sampler.othersUntil = time.Now().Add(othersHold)
}

func wantOthers() bool {
	sampler.mu.Lock()
	defer sampler.mu.Unlock()
	return time.Now().Before(sampler.othersUntil)
}
