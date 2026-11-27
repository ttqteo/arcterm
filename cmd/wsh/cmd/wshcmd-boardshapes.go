// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// boardShapesMax caps the list: a board past it is listed in part, the rest counted, so a prompt that names a large
// board never carries more than a few thousand tokens of it
const boardShapesMax = 300

// shape ids are cut to this many characters, longer only where two would read the same
const boardShapeIdLen = 8

var boardShapesCmd = &cobra.Command{
	Use:   "shapes board:<id>",
	Short: "list a board's shapes, one per line as `<id> <text>`, for linking them in a reply as [words](#shape-<id>)",
	Long: `List the shapes of a board that hold text, and its drawings (frames), one per line as "<id> <text>". The id is
what Chat's links point at: [the words](#shape-<id>) in a reply shows that shape on the board beside the Chat when it
is clicked. Text inside a box is listed under the box's id, so a click shows the box.`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    boardShapesRun,
}

func init() {
	boardCmd.AddCommand(boardShapesCmd)
}

func boardShapesRun(cmd *cobra.Command, args []string) error {
	id, ok := boardRefID(args[0])
	if !ok {
		return fmt.Errorf("pass the board as board:<id>, as Chat's @ picker writes it (got %q)", args[0])
	}
	list, err := wshclient.BoardListCommand(RpcClient, wshrpc.CommandBoardListData{}, nil)
	if err != nil {
		return err
	}
	var info *wshrpc.BoardInfo
	for i := range list.Boards {
		if list.Boards[i].ID == id {
			info = &list.Boards[i]
			break
		}
	}
	if info == nil {
		return fmt.Errorf("no board has the id %s", id)
	}
	read, err := wshclient.BoardReadCommand(RpcClient, wshrpc.CommandBoardRefData{Project: info.Project, BoardId: id}, nil)
	if err != nil {
		return err
	}
	lines, more, err := boardShapeLines(read.Data, boardShapesMax)
	if err != nil {
		return err
	}
	fmt.Println(strings.Join(lines, "\n"))
	if more > 0 {
		fmt.Printf("… and %d more shapes not listed\n", more)
	}
	return nil
}

// boardRefID is the id in `board:<id>` (any case), as boardstore.RefID reads it; not imported, since boardstore pulls
// wavesrv's stores into wsh. A prefix of an id is no id: the list matches the whole one.
func boardRefID(ref string) (string, bool) {
	ref = strings.TrimSpace(ref)
	const prefix = "board:"
	if len(ref) <= len(prefix) || !strings.EqualFold(ref[:len(prefix)], prefix) {
		return "", false
	}
	id := strings.ToLower(ref[len(prefix):])
	for _, r := range id {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r == '-') {
			return "", false
		}
	}
	return id, true
}

type boardShapeElement struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"`
	IsDeleted    bool    `json:"isDeleted"`
	Text         string  `json:"text"`
	OriginalText *string `json:"originalText"`
	ContainerID  *string `json:"containerId"`
	Name         *string `json:"name"`
}

// boardShapeLines is the board file's shapes as "<id> <text>" lines: its drawings (frames, "[drawing]" before the
// title) first, then each text in file order under its box's id (a text in no box under its own). An id is cut to
// boardShapeIdLen characters, longer where two ids share that prefix. At most max lines; more is how many were left
// out.
func boardShapeLines(data string, max int) (lines []string, more int, err error) {
	var file struct {
		Elements []boardShapeElement `json:"elements"`
	}
	if err := json.Unmarshal([]byte(data), &file); err != nil {
		return nil, 0, errors.New("the board file does not read as a board")
	}
	type row struct{ id, text string }
	var frames, texts []row
	for _, e := range file.Elements {
		if e.IsDeleted {
			continue
		}
		switch e.Type {
		case "frame":
			if e.Name != nil && strings.TrimSpace(*e.Name) != "" {
				frames = append(frames, row{e.ID, "[drawing] " + oneLine(*e.Name)})
			}
		case "text":
			text := e.Text
			if e.OriginalText != nil {
				text = *e.OriginalText
			}
			if strings.TrimSpace(text) == "" {
				continue
			}
			id := e.ID
			if e.ContainerID != nil && *e.ContainerID != "" {
				id = *e.ContainerID
			}
			texts = append(texts, row{id, oneLine(text)})
		}
	}
	rows := append(frames, texts...)
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.id
	}
	short := shortIds(ids, boardShapeIdLen)
	for i, r := range rows {
		if len(lines) == max {
			return lines, len(rows) - max, nil
		}
		lines = append(lines, short[i]+" "+r.text)
	}
	return lines, 0, nil
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// shortIds cuts each id to n characters, or to the shortest longer prefix no other id starts with (the whole id at
// most). The same id twice cuts the same way.
func shortIds(ids []string, n int) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		k := min(n, len(id))
		for k < len(id) && sharesPrefix(ids, id, k) {
			k++
		}
		out[i] = id[:k]
	}
	return out
}

func sharesPrefix(ids []string, id string, k int) bool {
	for _, other := range ids {
		if other != id && len(other) >= k && other[:k] == id[:k] {
			return true
		}
	}
	return false
}
