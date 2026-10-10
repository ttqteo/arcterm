// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"context"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// A Terminal launched with a command (cmd:firstcommand) is a plain shell that gets the command typed at its first
// prompt, the way a person would type it: the shell's rc files have run (so their PATH applies), the command lands in
// history, and the shell stays when it ends. The init script cannot do this: it runs before the user's rc files.

// shellPromptMark is the OSC 16162 "A" every integrated shell prints from its prompt hook.
var shellPromptMark = []byte("\x1b]16162;A")

// The mark comes from the prompt hook, before the prompt is drawn and the line editor takes the terminal; text that
// arrives sooner is echoed by the tty once before the prompt. So the command waits for the output to go quiet.
const firstCommandSettle = 150 * time.Millisecond

// A shell that never prints the mark (macOS's bash 3.2 runs without integration, or an rc file drops the hooks) gets
// the command anyway, which it reads as typeahead.
const firstCommandFallback = 10 * time.Second

type firstCommandTyper struct {
	lock   sync.Mutex
	settle time.Duration
	tail   []byte // the end of the output so far, for a mark split across reads
	marked bool
	done   bool
	timer  *time.Timer
	send   func()
}

func newFirstCommandTyper(settle time.Duration, fallback time.Duration, send func()) *firstCommandTyper {
	t := &firstCommandTyper{settle: settle, send: send}
	t.timer = time.AfterFunc(fallback, t.fire)
	return t
}

// output takes each chunk the shell writes
func (t *firstCommandTyper) output(chunk []byte) {
	t.lock.Lock()
	defer t.lock.Unlock()
	if t.done {
		return
	}
	if !t.marked {
		buf := append(t.tail, chunk...)
		if !bytes.Contains(buf, shellPromptMark) {
			keep := min(len(buf), len(shellPromptMark)-1)
			t.tail = append([]byte(nil), buf[len(buf)-keep:]...)
			return
		}
		t.marked = true
		t.tail = nil
	}
	t.timer.Reset(t.settle)
}

func (t *firstCommandTyper) fire() {
	t.lock.Lock()
	if t.done {
		t.lock.Unlock()
		return
	}
	t.done = true
	t.lock.Unlock()
	t.send()
}

// stop is for a shell that ended before the command was typed
func (t *firstCommandTyper) stop() {
	t.lock.Lock()
	defer t.lock.Unlock()
	t.done = true
	t.timer.Stop()
}

// takeFirstCommand returns a shell block's first command and clears it from the block, so a restart of the shell or of
// the app does not type it again.
func takeFirstCommand(blockId string, blockMeta waveobj.MetaMapType) string {
	cmd := blockMeta.GetString(waveobj.MetaKey_CmdFirstCommand, "")
	if cmd == "" {
		return ""
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	clear := waveobj.MetaMapType{waveobj.MetaKey_CmdFirstCommand: nil}
	if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId), clear, false); err != nil {
		// typing it again on the next start is worse than not typing it at all
		log.Printf("block %s: cannot clear cmd:firstcommand, not typing it: %v\n", blockId, err)
		return ""
	}
	return cmd
}
