// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// wshRequest is one call the skill made to the fake wsh: "judge" (with the person's --line, when it passed one) or
// "check", on a brainstorm.json.
type wshRequest struct {
	Cmd  string `json:"cmd"`
	File string `json:"file"`
	Line string `json:"line"`
}

// fakeWshBody is the script after its first lines, which writeFakeWsh bakes the requests file's path into. Plain POSIX
// sh: Claude's Bash tool on Windows is Git Bash. It stands in for the real wsh, which would call wavesrv: the skill's
// `wsh brainstorm judge` and `wsh brainstorm check` are recorded for the driver to answer, and every other call
// (`ui reveal`, ...) does nothing.
const fakeWshBody = `
# jsonstr prints its argument as the inside of a JSON string: control characters (tab, CR and LF among them) become
# spaces, then a backslash and a double quote are escaped.
jsonstr() {
	printf '%s' "$1" | tr '\001-\037' '[ *]' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

if [ "$1" != brainstorm ]; then
	exit 0
fi
case "$2" in
judge | check) ;;
*) exit 0 ;;
esac
sub=$2
shift 2

file=
line=
count=0
while [ $# -gt 0 ]; do
	case "$1" in
	--line)
		shift
		if [ $# -gt 0 ]; then
			line=$1
			shift
		fi
		;;
	--line=*)
		line=${1#--line=}
		shift
		;;
	-*)
		shift
		;;
	*)
		count=$((count + 1))
		if [ "$count" -eq 1 ]; then
			file=$1
		fi
		shift
		;;
	esac
done

# the real command takes exactly one path
if [ "$count" -ne 1 ]; then
	echo "Error: accepts 1 arg(s), received $count" >&2
	exit 1
fi

file=$(jsonstr "$file")
if [ "$sub" = judge ]; then
	line=$(jsonstr "$line")
	printf '{"cmd":"judge","file":"%s","line":"%s"}\n' "$file" "$line" >>"$requests" || exit 1
	echo "judge started"
else
	printf '{"cmd":"check","file":"%s"}\n' "$file" >>"$requests" || exit 1
	echo "builder check started"
fi
`

// writeFakeWsh writes the fake wsh, a POSIX sh script named wsh, into binDir (which must exist). It appends one JSON
// line per brainstorm judge / check call to requestsPath, which readRequests reads back.
func writeFakeWsh(binDir, requestsPath string) error {
	script := "#!/bin/sh\nrequests=" + shellQuote(filepath.ToSlash(requestsPath)) + "\n" + fakeWshBody
	if err := os.WriteFile(filepath.Join(binDir, "wsh"), []byte(script), 0o755); err != nil {
		return fmt.Errorf("writing the fake wsh: %w", err)
	}
	return nil
}

// shellQuote quotes s as one POSIX sh word.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// readRequests reads the requests file in the order the calls were made. A file that is not there yet is no requests;
// a line that is not JSON is an error naming the line.
func readRequests(path string) ([]wshRequest, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the fake wsh's requests: %w", err)
	}
	var out []wshRequest
	for i, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var req wshRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			return nil, fmt.Errorf("%s line %d is not JSON (%q): %w", path, i+1, line, err)
		}
		out = append(out, req)
	}
	return out, nil
}
