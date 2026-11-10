// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudecmds

import (
	"errors"
	"fmt"
	"sync"
)

// The live list is the slash command list a running Claude session itself offers (`$.command.list()` in Claude Code's
// mod API): the built-ins, the bundled skills, the commands a mod registers at runtime and the MCP prompts, none of
// which List can read off disk. The arc mod publishes it per agent block through `wsh claudecmds set` whenever it
// changes, and the chat view's `/` menu reads it back with GetClaudeLiveCommandsCommand, falling back to List when a
// block has none. It is held in memory only: a list is ~20 KB, and after a wavesrv restart the mod's next publish
// refills it.

const (
	// maxLiveCommands bounds one published list; Claude Code offers well under 300.
	maxLiveCommands = 2000
	// maxLiveDescription is how many characters of a description the live list keeps.
	maxLiveDescription = 300
)

// LiveCommand is one entry of a live list. Name has no leading slash. Source is Claude Code's own: "builtin",
// "plugin", "user" or "mcp". Plugin names the plugin of a "plugin" entry.
type LiveCommand struct {
	Name        string
	Description string
	Source      string
	Plugin      string
}

var (
	liveMu   sync.Mutex
	liveLast = map[string][]LiveCommand{}
)

// SetLive keeps list as blockID's newest live list, replacing the one before. Entries with no name are dropped and a
// description is cut to maxLiveDescription characters. It refuses an empty block id and a list over maxLiveCommands.
func SetLive(blockID string, list []LiveCommand) error {
	if blockID == "" {
		return errors.New("a live command list needs a block id")
	}
	if len(list) > maxLiveCommands {
		return fmt.Errorf("a live command list holds at most %d commands, got %d", maxLiveCommands, len(list))
	}
	kept := make([]LiveCommand, 0, len(list))
	for _, c := range list {
		if c.Name == "" {
			continue
		}
		if r := []rune(c.Description); len(r) > maxLiveDescription {
			c.Description = string(r[:maxLiveDescription])
		}
		kept = append(kept, c)
	}
	liveMu.Lock()
	liveLast[blockID] = kept
	liveMu.Unlock()
	return nil
}

// Live is a copy of blockID's newest live list, and whether it has one.
func Live(blockID string) ([]LiveCommand, bool) {
	liveMu.Lock()
	defer liveMu.Unlock()
	list, ok := liveLast[blockID]
	if !ok {
		return nil, false
	}
	return append([]LiveCommand(nil), list...), true
}
