// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/canvasserve"
	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) FileCreateCommand(ctx context.Context, data wshrpc.FileData) error {
	data.Data64 = ""
	err := wshfs.PutFile(ctx, data)
	if err != nil {
		return fmt.Errorf("error creating file: %w", err)
	}
	return nil
}

func (ws *WshServer) FileMkdirCommand(ctx context.Context, data wshrpc.FileData) error {
	return wshfs.Mkdir(ctx, data.Info.Path)
}

func (ws *WshServer) FileDeleteCommand(ctx context.Context, data wshrpc.CommandDeleteFileData) error {
	return wshfs.Delete(ctx, data)
}

func (ws *WshServer) FileInfoCommand(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileInfo, error) {
	return wshfs.Stat(ctx, data.Info.Path)
}

func (ws *WshServer) CanvasServeCommand(ctx context.Context, designDir string) (string, error) {
	return canvasserve.Register(designDir)
}

func (ws *WshServer) FileWriteCommand(ctx context.Context, data wshrpc.FileData) error {
	return wshfs.PutFile(ctx, data)
}

func (ws *WshServer) FileReadCommand(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileData, error) {
	return wshfs.Read(ctx, data)
}

func (ws *WshServer) FileMoveCommand(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	return wshfs.Move(ctx, data)
}

func (ws *WshServer) FileJoinCommand(ctx context.Context, paths []string) (*wshrpc.FileInfo, error) {
	if len(paths) < 2 {
		if len(paths) == 0 {
			return nil, fmt.Errorf("no paths provided")
		}
		return wshfs.Stat(ctx, paths[0])
	}
	return wshfs.Join(ctx, paths[0], paths[1:]...)
}

const (
	// WriteTempFileCommand writes each channel-composer attachment into its own temp dir under this
	// prefix. Deliberately more specific than the bare "waveterm-" prefix used elsewhere (e.g. the
	// /tmp/waveterm-<uid> socket dir), so SweepTempAttachments only ever removes attachment dirs and
	// can never delete a live socket dir that happens to share the OS temp dir on Linux/macOS.
	tempAttachPrefix = "waveterm-attach-"
	// A worker reads its attachment shortly after send, so a dir older than this is certainly done.
	tempAttachRetention = 24 * time.Hour
)

func (ws *WshServer) WriteTempFileCommand(ctx context.Context, data wshrpc.CommandWriteTempFileData) (string, error) {
	if data.FileName == "" {
		return "", fmt.Errorf("filename is required")
	}
	name := filepath.Base(data.FileName)
	if name == "" || name == "." || name == ".." {
		return "", fmt.Errorf("invalid filename")
	}
	tempDir, err := os.MkdirTemp("", tempAttachPrefix)
	if err != nil {
		return "", fmt.Errorf("error creating temp directory: %w", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return "", fmt.Errorf("error decoding base64 data: %w", err)
	}
	tempPath := filepath.Join(tempDir, name)
	err = os.WriteFile(tempPath, decoded, 0600)
	if err != nil {
		return "", fmt.Errorf("error writing temp file: %w", err)
	}
	return tempPath, nil
}

// SweepTempAttachments removes stale channel-composer attachment temp dirs (tempAttachPrefix*) left in
// the OS temp dir by WriteTempFileCommand, which creates one dir per file and never deletes it — so
// they accumulate unbounded over a long session. Best-effort: a dir older than tempAttachRetention is
// certainly done (its worker read the file shortly after send); a still-referenced recent one is left
// alone. Individual failures are ignored — the next sweep retries.
func SweepTempAttachments() {
	sweepTempAttachments(os.TempDir(), tempAttachRetention)
}

func sweepTempAttachments(dir string, retention time.Duration) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("SweepTempAttachments: reading temp dir: %v\n", err)
		return
	}
	cutoff := time.Now().Add(-retention)
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), tempAttachPrefix) {
			continue
		}
		info, err := e.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		_ = os.RemoveAll(filepath.Join(dir, e.Name()))
	}
}

// The canvas Send writes <project>/.superpowers/design/<topic>/feedback/NNN.png and nothing else deletes them.
// The agent reads its picture right after the line is typed, so one older than this is done with.
const canvasFeedbackRetention = 7 * 24 * time.Hour

// the names nextFeedbackName (canvasmarks.ts) writes
var canvasFeedbackName = regexp.MustCompile(`^\d{3,}\.png$`)

// SweepCanvasFeedback removes stale canvas feedback pictures in every registered project. A canvas in an
// unregistered folder is not swept.
func SweepCanvasFeedback() {
	projects := memroots.RegistryProjects()
	roots := make([]string, 0, len(projects))
	for _, p := range projects {
		roots = append(roots, p)
	}
	sweepCanvasFeedback(roots, canvasFeedbackRetention)
}

func sweepCanvasFeedback(roots []string, retention time.Duration) {
	cutoff := time.Now().Add(-retention)
	for _, root := range roots {
		design := filepath.Join(root, ".superpowers", "design")
		// most projects have no canvas, so a missing dir is not worth a log line
		topics, err := os.ReadDir(design)
		if err != nil {
			continue
		}
		for _, t := range topics {
			if t.IsDir() {
				sweepFeedbackDir(filepath.Join(design, t.Name(), "feedback"), cutoff)
			}
		}
	}
}

// Only regular files with a Send name are removed, never a dir, and a feedback dir that is a link or junction
// is skipped, so a sweep cannot reach outside the canvas folder.
func sweepFeedbackDir(dir string, cutoff time.Time) {
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("SweepCanvasFeedback: reading %s: %v\n", dir, err)
		return
	}
	for _, e := range entries {
		if !e.Type().IsRegular() || !canvasFeedbackName.MatchString(e.Name()) {
			continue
		}
		fi, err := e.Info()
		if err != nil || !fi.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
			log.Printf("SweepCanvasFeedback: %v\n", err)
		}
	}
}
