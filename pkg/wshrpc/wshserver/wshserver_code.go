// pkg/wshrpc/wshserver/wshserver_code.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	reviewMaxAge   = 7 * 24 * time.Hour
	reviewMaxBytes = 1 << 20
	// sortable and filesystem-safe: no colons, which Windows rejects in a file name
	reviewStampLayout = "20060102T150405.000Z"
)

var unsafeProjectChars = regexp.MustCompile(`[^A-Za-z0-9._-]`)

func (ws *WshServer) CodeReviewWriteCommand(ctx context.Context, data wshrpc.CommandCodeReviewWriteData) (*wshrpc.CommandCodeReviewWriteRtnData, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolving the home directory: %w", err)
	}
	path, err := writeReview(filepath.Join(home, ".arc", "review"), data.Project, data.Markdown, time.Now())
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandCodeReviewWriteRtnData{Path: path}, nil
}

// writeReview saves a review as <root>/<project>/<stamp>.md, where the agent reads it by path, then
// prunes old reviews. The project arrives from the surface, so it is reduced to one path segment
// before it is joined onto root.
func writeReview(root, project, markdown string, now time.Time) (string, error) {
	safe := strings.TrimLeft(unsafeProjectChars.ReplaceAllString(project, "-"), ".")
	if safe == "" {
		return "", fmt.Errorf("review project %q has no usable name", project)
	}
	if markdown == "" {
		return "", fmt.Errorf("review is empty")
	}
	if len(markdown) > reviewMaxBytes {
		return "", fmt.Errorf("review is %d bytes, over the %d byte cap", len(markdown), reviewMaxBytes)
	}
	dir := filepath.Join(root, safe)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating %s: %w", dir, err)
	}
	path := filepath.Join(dir, now.UTC().Format(reviewStampLayout)+".md")
	if err := os.WriteFile(path, []byte(markdown), 0o644); err != nil {
		return "", fmt.Errorf("writing %s: %w", path, err)
	}
	if err := pruneReviews(root, now.Add(-reviewMaxAge)); err != nil {
		log.Printf("review: pruning %s: %v", root, err)
	}
	return path, nil
}

func pruneReviews(root string, cutoff time.Time) error {
	files, err := filepath.Glob(filepath.Join(root, "*", "*.md"))
	if err != nil {
		return err
	}
	for _, f := range files {
		info, err := os.Stat(f)
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(f); err != nil {
			log.Printf("review: removing %s: %v", f, err)
		}
	}
	return nil
}
