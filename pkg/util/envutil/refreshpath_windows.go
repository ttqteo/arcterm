// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package envutil

import (
	"golang.org/x/sys/windows/registry"
)

// osPath reads PATH the way a new login session builds it: the machine's entries, then the user's, with %VAR%
// references expanded.
func osPath() (string, bool) {
	machine := regPath(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`)
	user := regPath(registry.CURRENT_USER, `Environment`)
	if machine == "" && user == "" {
		return "", false
	}
	if machine == "" || user == "" {
		return machine + user, true
	}
	return machine + ";" + user, true
}

func regPath(root registry.Key, subkey string) string {
	k, err := registry.OpenKey(root, subkey, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	val, valType, err := k.GetStringValue("Path")
	if err != nil {
		return ""
	}
	if valType == registry.EXPAND_SZ {
		if expanded, err := registry.ExpandString(val); err == nil {
			return expanded
		}
	}
	return val
}
