// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"strconv"
)

// Claude Code asks whether to trust a folder before it loads any hook or reports any OSC 7501 state, so an agent that
// meets the prompt (a restore relaunched it in a folder named with another drive-letter case, 2026-11-17) kept its last
// state, working, while it waited on the person. trustScan finds the prompt in the process's output itself.
//
// Claude Code draws the prompt with escape codes between its words ("Quick\x1b[1Csafety"), so the scan reads the
// output as text: a cursor-forward is the spaces it skips, a cursor move to another row a line break, every other
// escape sequence nothing. Both markers must show inside one window of that text; the prompt draws them a few rows
// apart, in one render.
var trustMarkers = [][]byte{[]byte("Quick safety check"), []byte("Yes, I trust this folder")}

// how much of the newest text the scan keeps: the prompt's whole first render, which is about 2 KB
const trustWindow = 8 * 1024

type escState int

const (
	escNone   escState = iota
	escStart           // after ESC
	escCSI             // inside ESC [ … final
	escOSC             // inside ESC ] … BEL or ESC \
	escOSCEsc          // an ESC inside an OSC, which a \ ends
)

type trustScan struct {
	state  escState
	params []byte
	text   []byte
}

// Feed reads one chunk of output and reports whether the text read so far shows the trust prompt.
func (s *trustScan) Feed(chunk []byte) bool {
	for _, b := range chunk {
		s.step(b)
	}
	if len(s.text) > trustWindow {
		s.text = append(s.text[:0], s.text[len(s.text)-trustWindow:]...)
	}
	for _, m := range trustMarkers {
		if !bytes.Contains(s.text, m) {
			return false
		}
	}
	return true
}

func (s *trustScan) step(b byte) {
	switch s.state {
	case escStart:
		switch b {
		case '[':
			s.state, s.params = escCSI, s.params[:0]
		case ']':
			s.state = escOSC
		default:
			s.state = escNone
		}
	case escCSI:
		// a CSI ends on its final byte, 0x40 to 0x7e
		if b < 0x40 || b > 0x7e {
			s.params = append(s.params, b)
			return
		}
		s.state = escNone
		switch b {
		case 'C':
			n, err := strconv.Atoi(string(s.params))
			if err != nil || n < 1 {
				n = 1
			}
			s.text = append(s.text, bytes.Repeat([]byte{' '}, min(n, 256))...)
		case 'H', 'f', 'd', 'E', 'F':
			s.text = append(s.text, '\n')
		}
	case escOSC:
		switch b {
		case 0x07:
			s.state = escNone
		case 0x1b:
			s.state = escOSCEsc
		}
	case escOSCEsc:
		if b == '\\' {
			s.state = escNone
		} else {
			s.state = escOSC
		}
	default:
		switch {
		case b == 0x1b:
			s.state = escStart
		case b == '\n' || b == '\r':
			s.text = append(s.text, '\n')
		case b >= 0x20 || b == '\t':
			s.text = append(s.text, b)
		}
	}
}
