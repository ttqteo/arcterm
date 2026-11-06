// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"fmt"
	"strings"
)

type RegionKind int

const (
	FrontmatterKey RegionKind = iota // a reserved top-level frontmatter key
	Block                            // a <!-- jarvis:begin NAME --> ... <!-- jarvis:end NAME --> body block
)

// RegionSpec declares which regions of a file Jarvis exclusively owns. Supplied by B (the dossier
// policy); A enforces it generically. Everything not named here is human-owned.
type RegionSpec struct {
	MachineKeys []string
	Blocks      []string
}

// RegionEdit is one machine-region write: a new Value for the frontmatter key or block named Name.
type RegionEdit struct {
	Kind  RegionKind
	Name  string
	Value string
}

// editsInSpec rejects any edit that targets a region not declared machine-owned by spec. This is the
// pre-check; validateMachineOnly is the post-splice guard against injection.
func editsInSpec(spec RegionSpec, edits []RegionEdit) error {
	keys := map[string]bool{}
	for _, k := range spec.MachineKeys {
		keys[k] = true
	}
	blocks := map[string]bool{}
	for _, b := range spec.Blocks {
		blocks[b] = true
	}
	for _, e := range edits {
		switch e.Kind {
		case FrontmatterKey:
			if !keys[e.Name] {
				return fmt.Errorf("wavevault: edit targets non-machine frontmatter key %q", e.Name)
			}
		case Block:
			if !blocks[e.Name] {
				return fmt.Errorf("wavevault: edit targets non-machine block %q", e.Name)
			}
		default:
			return fmt.Errorf("wavevault: unknown region kind %d", e.Kind)
		}
	}
	return nil
}

// spliceRegions applies each edit to content in order, returning the new content. Frontmatter keys
// are upserted; blocks are replaced between existing markers (an absent block errors — B scaffolds
// blocks). All bytes outside the targeted regions are preserved verbatim; a BOM and CRLF line ends are
// set aside for the splice (the front matter grammar is LF) and put back on the way out.
func spliceRegions(content string, edits []RegionEdit) (string, error) {
	out, bom, crlf := normalizeEOL(content)
	for _, e := range edits {
		switch e.Kind {
		case FrontmatterKey:
			out = setFrontmatterKey(out, e.Name, e.Value)
		case Block:
			var err error
			out, err = setBlock(out, e.Name, e.Value)
			if err != nil {
				return "", err
			}
		default:
			return "", fmt.Errorf("wavevault: unknown region kind %d", e.Kind)
		}
	}
	return restoreEOL(out, bom, crlf), nil
}

// setFrontmatterKey upserts a top-level "key: value" line inside the --- frontmatter block,
// preserving the body and all other keys. Creates a frontmatter block if none exists.
func setFrontmatterKey(content, key, value string) string {
	line := key + ": " + value
	if !strings.HasPrefix(content, "---\n") {
		return "---\n" + line + "\n---\n\n" + content
	}
	end := strings.Index(content[4:], "\n---")
	if end < 0 {
		return "---\n" + line + "\n---\n\n" + content
	}
	fmText := content[4 : 4+end]
	rest := content[4+end:] // starts at "\n---"
	lines := strings.Split(fmText, "\n")
	replaced := false
	for i, l := range lines {
		if !strings.HasPrefix(l, " ") && strings.HasPrefix(l, key+":") {
			lines[i] = line
			replaced = true
			break
		}
	}
	if !replaced {
		lines = append(lines, line)
	}
	return "---\n" + strings.Join(lines, "\n") + rest
}

// setBlock replaces the content between an existing <!-- jarvis:begin NAME --> / <!-- jarvis:end
// NAME --> pair. It errors if the block is absent (creating a block would introduce ambiguous
// surrounding whitespace that the diff-validator can't distinguish from a human edit; B scaffolds
// blocks when it renders a dossier).
func setBlock(content, name, value string) (string, error) {
	begin := "<!-- jarvis:begin " + name + " -->"
	end := "<!-- jarvis:end " + name + " -->"
	bi := strings.Index(content, begin)
	if bi < 0 {
		return "", fmt.Errorf("wavevault: machine block %q not present (B must scaffold it)", name)
	}
	after := bi + len(begin)
	rel := strings.Index(content[after:], end)
	if rel < 0 {
		return "", fmt.Errorf("wavevault: machine block %q has no end marker", name)
	}
	ei := after + rel
	return content[:after] + "\n" + value + "\n" + content[ei:], nil
}

// humanProjection removes every machine-owned region so two versions can be compared for
// human-region equality: a splice that touched only machine regions leaves this identical.
func humanProjection(content string, spec RegionSpec) string {
	out, _, _ := normalizeEOL(content)
	for _, name := range spec.Blocks {
		begin := "<!-- jarvis:begin " + name + " -->"
		end := "<!-- jarvis:end " + name + " -->"
		for {
			bi := strings.Index(out, begin)
			if bi < 0 {
				break
			}
			rel := strings.Index(out[bi:], end)
			if rel < 0 {
				break
			}
			ei := bi + rel + len(end)
			out = out[:bi] + out[ei:]
		}
	}
	if strings.HasPrefix(out, "---\n") {
		if e := strings.Index(out[4:], "\n---"); e >= 0 {
			fmText := out[4 : 4+e]
			rest := out[4+e:]
			machine := map[string]bool{}
			for _, k := range spec.MachineKeys {
				machine[k] = true
			}
			var kept []string
			for _, l := range strings.Split(fmText, "\n") {
				isMachine := false
				for k := range machine {
					if !strings.HasPrefix(l, " ") && strings.HasPrefix(l, k+":") {
						isMachine = true
						break
					}
				}
				if !isMachine {
					kept = append(kept, l)
				}
			}
			out = "---\n" + strings.Join(kept, "\n") + rest
		}
	}
	return out
}

// validateMachineOnly rejects a write whose human-owned regions differ from the original — the guard
// that makes it impossible to clobber human text (invariant 5).
func validateMachineOnly(oldContent, newContent string, spec RegionSpec) error {
	if humanProjection(oldContent, spec) != humanProjection(newContent, spec) {
		return fmt.Errorf("wavevault: write would modify a human-owned region")
	}
	return nil
}
