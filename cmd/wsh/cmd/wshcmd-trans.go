// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/translate"
)

// wsh trans is the Translate tool (pkg/arctools): a prompt that hands each line to translate-shell and prints its
// answer short. trans's own shell prints a word's whole dictionary entry, each meaning on two lines; this prints the
// translation with the word's phonetics, then one line per word class. translate-shell still does the fetching
// (trans -dump), so a change on Google's side is fixed by upgrading it; translate.Parse reads what it dumps.

const transDefaultTarget = "vi"

// set on the copy of wsh trans that runs under rlwrap, so it does not wrap itself again
const transRlwrapEnv = "ARC_TRANS_RLWRAP"

var transCmd = &cobra.Command{
	Use:   "trans [:lang]",
	Short: "translate each line you type, short: the translation, its phonetics and a word's meanings (into Vietnamese unless :lang names another)",
	Args:  cobra.MaximumNArgs(1),
	RunE:  runTransCmd,
}

func init() {
	rootCmd.AddCommand(transCmd)
}

// a line that switches the target language, as in trans's shell: :en, :vi, :zh-CN
var transLangLine = regexp.MustCompile(`^:([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?)$`)

func runTransCmd(cmd *cobra.Command, args []string) error {
	target := transDefaultTarget
	if len(args) == 1 {
		m := transLangLine.FindStringSubmatch(args[0])
		if m == nil {
			return fmt.Errorf("%q is not a language: give it as :en or :vi", args[0])
		}
		target = m[1]
	}
	trans, err := exec.LookPath("trans")
	if err != nil {
		return fmt.Errorf("translate-shell is not installed: brew install translate-shell rlwrap")
	}
	rlwrapSelf(args)
	name, err := transLangName(trans, target)
	if err != nil {
		return err
	}
	WriteStdout("\x1b[1mTranslate Shell\x1b[22m\n(:q quits, :en or :vi switches the language)\n")
	in := bufio.NewReader(os.Stdin)
	for {
		WriteStdout("\x1b[1m → %s ❯ \x1b[22m", name)
		line, err := in.ReadString('\n')
		line = strings.TrimSpace(line)
		switch {
		case line == ":q" || line == ":quit":
			return nil
		case transLangLine.MatchString(line):
			code := transLangLine.FindStringSubmatch(line)[1]
			if n, err := transLangName(trans, code); err != nil {
				WriteStdout("%v\n", err)
			} else {
				target, name = code, n
			}
		case line != "":
			if a, err := transLookup(trans, target, line); err != nil {
				WriteStdout("couldn't translate: %v\n", err)
			} else {
				WriteStdout("%s", formatTransAnswer(a, termWidth()))
			}
		}
		if err != nil {
			WriteStdout("\n")
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}

// rlwrapSelf runs this command again under rlwrap, as trans's shell does, so ↑ recalls past lookups; it returns only
// when it could not, and the prompt then runs without history. The history stays trans's own (~/.trans_history).
func rlwrapSelf(args []string) {
	if os.Getenv(transRlwrapEnv) != "" {
		return
	}
	if st, err := os.Stdin.Stat(); err != nil || st.Mode()&os.ModeCharDevice == 0 {
		return
	}
	rlwrap, err := exec.LookPath("rlwrap")
	if err != nil {
		return
	}
	self, err := os.Executable()
	if err != nil {
		return
	}
	argv := append([]string{"rlwrap", "-C", "trans", self, "trans"}, args...)
	_ = syscall.Exec(rlwrap, argv, append(os.Environ(), transRlwrapEnv+"=1"))
}

// transLangName is the language's own name for itself (Tiếng Việt, English), which the prompt shows.
func transLangName(trans, code string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(ctx, trans, "-no-ansi", "-L", code).CombinedOutput()
	first, _, _ := strings.Cut(string(out), "\n")
	first = strings.TrimSpace(first)
	if first == "" || strings.HasPrefix(first, "[ERROR]") {
		return "", fmt.Errorf("unknown language: %s", code)
	}
	return first, nil
}

func transLookup(trans, target, text string) (translate.Answer, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, trans, "-no-warn", "-dump", ":"+target, "--", text).Output()
	if err != nil {
		return translate.Answer{}, err
	}
	return translate.Parse(out)
}

var transPosShort = map[string]string{
	"noun": "n.", "verb": "v.", "adjective": "adj.", "adverb": "adv.", "preposition": "prep.", "pronoun": "pron.",
	"conjunction": "conj.", "interjection": "interj.", "abbreviation": "abbr.", "article": "art.", "phrase": "phr.",
}

// formatTransAnswer is what a lookup prints: the translation in bold with the phonetics after it, then one line per
// word class with its meanings, wrapped to width (0 does not wrap) under the first meaning.
func formatTransAnswer(a translate.Answer, width int) string {
	var sb strings.Builder
	sb.WriteString("\x1b[1m" + a.Translation + "\x1b[22m")
	if a.Phonetics != "" {
		sb.WriteString("  /" + a.Phonetics + "/")
	}
	sb.WriteString("\n")
	labels := make([]string, len(a.Classes))
	labelWidth := 0
	for i, c := range a.Classes {
		labels[i] = c.Pos
		if s, ok := transPosShort[c.Pos]; ok {
			labels[i] = s
		}
		labelWidth = max(labelWidth, utf8.RuneCountInString(labels[i]))
	}
	for i, c := range a.Classes {
		head := "  " + labels[i] + strings.Repeat(" ", labelWidth-utf8.RuneCountInString(labels[i])+2)
		indent := strings.Repeat(" ", utf8.RuneCountInString(head))
		line := head + c.Words[0]
		for _, w := range c.Words[1:] {
			next := line + " · " + w
			if width > 0 && utf8.RuneCountInString(next) > width {
				sb.WriteString(line + "\n")
				line = indent + w
				continue
			}
			line = next
		}
		sb.WriteString(line + "\n")
	}
	return sb.String()
}
