// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// file-related types and methods for wsh rpc calls
package wshrpc

import (
	"context"
	"os"
)

type WshRpcFileInterface interface {
	FileMkdirCommand(ctx context.Context, data FileData) error
	FileCreateCommand(ctx context.Context, data FileData) error
	FileDeleteCommand(ctx context.Context, data CommandDeleteFileData) error
	FileWriteCommand(ctx context.Context, data FileData) error
	FileReadCommand(ctx context.Context, data FileData) (*FileData, error)
	FileMoveCommand(ctx context.Context, data CommandFileCopyData) error
	FileInfoCommand(ctx context.Context, data FileData) (*FileInfo, error)
	FileJoinCommand(ctx context.Context, paths []string) (*FileInfo, error)
	CanvasServeCommand(ctx context.Context, designDir string) (string, error) // serves a .superpowers/design folder; returns its URL path on the web listener
}

type WshRpcRemoteFileInterface interface {
	RemoteFileStreamCommand(ctx context.Context, data CommandRemoteFileStreamData) (*FileInfo, error)
	RemoteFileCopyCommand(ctx context.Context, data CommandFileCopyData) (bool, error)
	RemoteListEntriesCommand(ctx context.Context, data CommandRemoteListEntriesData) chan RespOrErrorUnion[CommandRemoteListEntriesRtnData]
	RemoteFileInfoCommand(ctx context.Context, path string) (*FileInfo, error)
	RemoteFileMoveCommand(ctx context.Context, data CommandFileCopyData) error
	RemoteFileDeleteCommand(ctx context.Context, data CommandDeleteFileData) error
	RemoteWriteFileCommand(ctx context.Context, data FileData) error
	RemoteFileJoinCommand(ctx context.Context, paths []string) (*FileInfo, error)
	RemoteMkdirCommand(ctx context.Context, path string) error
}

type FileDataAt struct {
	Offset int64 `json:"offset"`
	Size   int   `json:"size,omitempty"`
}

type FileData struct {
	Info    *FileInfo   `json:"info,omitempty"`
	Data64  string      `json:"data64,omitempty"`
	Entries []*FileInfo `json:"entries,omitempty"`
	At      *FileDataAt `json:"at,omitempty"` // if set, this turns read/write ops to ReadAt/WriteAt ops (len is only used for ReadAt)
}

type FileInfo struct {
	Path          string      `json:"path"`          // cleaned path (may have "~")
	Dir           string      `json:"dir,omitempty"` // returns the directory part of the path (if this is a a directory, it will be equal to Path).  "~" will be expanded, and separators will be normalized to "/"
	Name          string      `json:"name,omitempty"`
	StatError     string      `json:"staterror,omitempty"`
	NotFound      bool        `json:"notfound,omitempty"`
	Opts          *FileOpts   `json:"opts,omitempty"`
	Size          int64       `json:"size,omitempty"`
	Meta          *FileMeta   `json:"meta,omitempty"`
	Mode          os.FileMode `json:"mode,omitempty"`
	ModeStr       string      `json:"modestr,omitempty"`
	ModTime       int64       `json:"modtime,omitempty"`
	IsDir         bool        `json:"isdir,omitempty"`
	SupportsMkdir bool        `json:"supportsmkdir,omitempty"`
	MimeType      string      `json:"mimetype,omitempty"`
	ReadOnly      bool        `json:"readonly,omitempty"` // this is not set for fileinfo's returned from directory listings
}

type FileOpts struct {
	MaxSize  int64 `json:"maxsize,omitempty"`
	Circular bool  `json:"circular,omitempty"`
	Truncate bool  `json:"truncate,omitempty"`
	Append   bool  `json:"append,omitempty"`
}

type FileMeta = map[string]any

type FileListData struct {
	Path string        `json:"path"`
	Opts *FileListOpts `json:"opts,omitempty"`
}

type FileListOpts struct {
	All    bool `json:"all,omitempty"`
	Offset int  `json:"offset,omitempty"`
	Limit  int  `json:"limit,omitempty"`
}

type CommandDeleteFileData struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive"`
}

type CommandFileCopyData struct {
	SrcUri  string        `json:"srcuri"`
	DestUri string        `json:"desturi"`
	Opts    *FileCopyOpts `json:"opts,omitempty"`
}

type FileCopyOpts struct {
	Overwrite bool  `json:"overwrite,omitempty"`
	Recursive bool  `json:"recursive,omitempty"` // only used for move, always true for copy
	Merge     bool  `json:"merge,omitempty"`
	Timeout   int64 `json:"timeout,omitempty"`
}

type CommandRemoteFileStreamData struct {
	Path       string     `json:"path"`
	ByteRange  string     `json:"byterange,omitempty"`
	StreamMeta StreamMeta `json:"streammeta"`
}

type CommandFileStreamData struct {
	Info       *FileInfo  `json:"info"`
	ByteRange  string     `json:"byterange,omitempty"`
	StreamMeta StreamMeta `json:"streammeta"`
}

type CommandRemoteListEntriesData struct {
	Path string        `json:"path"`
	Opts *FileListOpts `json:"opts,omitempty"`
}

type CommandRemoteListEntriesRtnData struct {
	FileInfo []*FileInfo `json:"fileinfo,omitempty"`
}
