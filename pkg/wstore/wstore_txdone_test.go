// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

// A context that ends after the last statement makes database/sql roll the transaction back, and the commit
// then fails with sql.ErrTxDone. The error says the context ended, and still matches both causes.
func TestTxEndedByItsContextNamesTheContext(t *testing.T) {
	cases := map[string]func(ctx context.Context, cancel context.CancelFunc) error{
		"write": func(ctx context.Context, cancel context.CancelFunc) error {
			return WithTx(ctx, func(tx *TxWrap) error {
				tx.GetString("SELECT 1")
				cancel()
				time.Sleep(100 * time.Millisecond) // database/sql rolls back from its own goroutine
				return nil
			})
		},
		"read": func(ctx context.Context, cancel context.CancelFunc) error {
			_, err := WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
				s := tx.GetString("SELECT 1")
				cancel()
				time.Sleep(100 * time.Millisecond)
				return s, nil
			})
			return err
		},
	}
	for name, run := range cases {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			err := run(ctx, cancel)
			if err == nil {
				t.Fatal("want an error from a transaction whose context ended, got nil")
			}
			if !errors.Is(err, context.Canceled) {
				t.Errorf("errors.Is(err, context.Canceled) = false; err = %v", err)
			}
			if !errors.Is(err, sql.ErrTxDone) {
				t.Errorf("errors.Is(err, sql.ErrTxDone) = false; err = %v", err)
			}
			if !strings.HasPrefix(err.Error(), "context canceled") {
				t.Errorf("want the message to lead with the context's error, got %q", err.Error())
			}
		})
	}
}

// A transaction that commits keeps returning nil, and an error unrelated to the context passes through as is.
func TestExplainTxDoneLeavesOtherErrorsAlone(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	other := errors.New("boom")
	if got := explainTxDone(ctx, other); got != other {
		t.Errorf("explainTxDone(other) = %v, want it unchanged", got)
	}
	if got := explainTxDone(context.Background(), sql.ErrTxDone); got != sql.ErrTxDone {
		t.Errorf("explainTxDone with a live context = %v, want sql.ErrTxDone unchanged", got)
	}
	if got := explainTxDone(ctx, nil); got != nil {
		t.Errorf("explainTxDone(nil) = %v, want nil", got)
	}
}
