// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows && !darwin

package secretstore

// Tauri packaging targets Windows (crypt_windows.go) and macOS (crypt_darwin.go); the shell-side keyring
// that used to serve Linux is gone with Electron. Rather than ship an untested keyring integration, these
// report unsupported: the store degrades to in-memory, so its secrets last until wavesrv exits.

func protect(_ []byte) ([]byte, error) { return nil, ErrPersistUnsupported }

func unprotect(_ []byte) ([]byte, error) { return nil, ErrPersistUnsupported }
