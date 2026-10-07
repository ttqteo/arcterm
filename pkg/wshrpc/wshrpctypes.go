// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type MultiArg struct {
	Args []any `json:"args"`
}

// Instructions for adding a new RPC call
// * methods must end with Command
// * methods must take context as their first parameter
// * methods may take additional typed parameters, and may return either just an error, or one return value plus an error
// * after modifying WshRpcInterface, run `task generate` to regnerate bindings

type WshRpcInterface interface {
	CoreCommands
	BlockCommands
	ProjectCommands
	GitCommands
	AgentCommands
	AgentSyncCommands
	SessionCommands
	ChannelCommands
	RunCommands
	DagCommands
	RadarCommands
	JarvisCommands
	EffortCommands
	SecretCommands
	ClaudeAccountCommands
	AskCommands
	NotifyCommands
	VaultCommands
	UiCommands
	StreamCommands
	DocCommands
	WshRpcRemoteFileInterface
	WshRpcFileInterface
}

type CoreCommands interface {
	AuthenticateCommand(ctx context.Context, data string) (CommandAuthenticateRtnData, error)
	AuthenticateTokenCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error)
	AuthenticateTokenVerifyCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error) // (special) validates token without binding, root router only
	RouteAnnounceCommand(ctx context.Context) error                                                                            // (special) announces a new route to the main router
	RouteUnannounceCommand(ctx context.Context) error                                                                          // (special) unannounces a route to the main router
	SetPeerInfoCommand(ctx context.Context, peerInfo string) error
	MessageCommand(ctx context.Context, data CommandMessageData) error
	GetMetaCommand(ctx context.Context, data CommandGetMetaData) (waveobj.MetaMapType, error)
	SetMetaCommand(ctx context.Context, data CommandSetMetaData) error
	ResolveIdsCommand(ctx context.Context, data CommandResolveIdsData) (CommandResolveIdsRtnData, error)
	EventPublishCommand(ctx context.Context, data wps.WaveEvent) error
	EventSubCommand(ctx context.Context, data wps.SubscriptionRequest) error
	EventUnsubCommand(ctx context.Context, data string) error
	EventReadHistoryCommand(ctx context.Context, data CommandEventReadHistoryData) ([]*wps.WaveEvent, error)
	WriteTempFileCommand(ctx context.Context, data CommandWriteTempFileData) (string, error)
	SetConfigCommand(ctx context.Context, data MetaSettingsType) error
	GetFullConfigCommand(ctx context.Context) (wconfig.FullConfigType, error)
	WaveInfoCommand(ctx context.Context) (*WaveInfoData, error)
	PathCommand(ctx context.Context, data PathCommandData) (string, error)
	UpdateWorkspaceTabIdsCommand(ctx context.Context, workspaceId string, tabIds []string) error
	GetAllBadgesCommand(ctx context.Context) ([]baseds.BadgeEvent, error)
	// eventrecv is special, it's handled internally by WshRpc with EventListener
	EventRecvCommand(ctx context.Context, data wps.WaveEvent) error
	// emain
	// ai
	// rtinfo
	GetRTInfoCommand(ctx context.Context, data CommandGetRTInfoData) (*waveobj.ObjRTInfo, error)
	SetRTInfoCommand(ctx context.Context, data CommandSetRTInfoData) error
	// jobs
}

// for frontend
type WshServerCommandMeta struct {
	CommandType string `json:"commandtype"`
}

type RpcOpts struct {
	Timeout    int64  `json:"timeout,omitempty"`
	NoResponse bool   `json:"noresponse,omitempty"`
	Route      string `json:"route,omitempty"`

	StreamCancelFn func(context.Context) error `json:"-"` // this is an *output* parameter, set by the handler
}

type RpcContext struct {
	SockName  string `json:"sockname,omitempty"`  // the domain socket name
	RouteId   string `json:"routeid"`             // the routeid from the jwt
	ProcRoute bool   `json:"procroute,omitempty"` // use a random procid for route
	BlockId   string `json:"blockid,omitempty"`   // blockid for this rpc
	Conn      string `json:"conn,omitempty"`      // the conn name
	IsRouter  bool   `json:"isrouter,omitempty"`  // if this is for a sub-router
}

func (rc RpcContext) GenerateRouteId() string {
	if rc.RouteId != "" {
		return rc.RouteId
	}
	return "proc:" + uuid.New().String()
}

type CommandAuthenticateRtnData struct {
	RouteId string `json:"routeid"`

	// these fields are only set when doing a token swap
	Env            map[string]string `json:"env,omitempty"`
	InitScriptText string            `json:"initscripttext,omitempty"`
	RpcContext     *RpcContext       `json:"rpccontext,omitempty"`
}

type CommandAuthenticateTokenData struct {
	Token string `json:"token"`
}

type CommandMessageData struct {
	Message string `json:"message"`
}

type CommandGetMetaData struct {
	ORef waveobj.ORef `json:"oref"`
}

type CommandSetMetaData struct {
	ORef waveobj.ORef        `json:"oref"`
	Meta waveobj.MetaMapType `json:"meta"`
}

type CommandResolveIdsData struct {
	BlockId string   `json:"blockid"`
	Ids     []string `json:"ids"`
}

type CommandResolveIdsRtnData struct {
	ResolvedIds map[string]waveobj.ORef `json:"resolvedids"`
}

type CommandEventReadHistoryData struct {
	Event    string `json:"event"`
	Scope    string `json:"scope"`
	MaxItems int    `json:"maxitems"`
}

type CommandWriteTempFileData struct {
	FileName string `json:"filename"`
	Data64   string `json:"data64"`
}

const (
	TimeSeries_Cpu = "cpu"
)

type MetaSettingsType struct {
	waveobj.MetaMapType
}

func (m *MetaSettingsType) UnmarshalJSON(data []byte) error {
	var metaMap waveobj.MetaMapType
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&metaMap); err != nil {
		return err
	}
	*m = MetaSettingsType{MetaMapType: metaMap}
	return nil
}

func (m MetaSettingsType) MarshalJSON() ([]byte, error) {
	return json.Marshal(m.MetaMapType)
}

type BranchInfo struct {
	Name string `json:"name"`
	Age  string `json:"age"`
	// True for a refs/remotes ref. The picker groups on this; the New Agent launcher never sees one.
	Remote bool `json:"remote,omitempty"`
}

type WaveInfoData struct {
	Version   string `json:"version"`
	ClientId  string `json:"clientid"`
	BuildTime string `json:"buildtime"`
	ConfigDir string `json:"configdir"`
	DataDir   string `json:"datadir"`
}

type SubagentFileInfo struct {
	AgentId        string `json:"agentid"`
	TranscriptPath string `json:"transcriptpath"`
	FirstPrompt    string `json:"firstprompt"`
	StartedAtMs    int64  `json:"startedatms"`
	Done           bool   `json:"done"` // last record is a terminal assistant turn (finished; outcome unknown)
}

type UsageBucket struct {
	Harness         string   `json:"harness"`
	Provider        string   `json:"provider"`
	Model           string   `json:"model"`
	Day             string   `json:"day"`
	Input           int      `json:"input"`
	Output          int      `json:"output"`
	Reasoning       int      `json:"reasoning"`
	CacheRead       int      `json:"cacheread"`
	CacheCreate     int      `json:"cachecreate"`
	CacheCreate1h   int      `json:"cachecreate1h"`
	ReportedCostUsd *float64 `json:"reportedcostusd,omitempty"`
	Msgs            int      `json:"msgs"`
}

type SessionInfo struct {
	ID             string   `json:"id"`
	Runtime        string   `json:"runtime"`
	ProjectPath    string   `json:"projectpath"`
	ProjectName    string   `json:"projectname"`
	Branch         string   `json:"branch"`
	Task           string   `json:"task"`
	Model          string   `json:"model"`
	TokensTotal    int      `json:"tokenstotal"`
	LastActiveTs   int64    `json:"lastactivets"`
	ResumeCommand  string   `json:"resumecommand"`
	TranscriptPath string   `json:"transcriptpath"`
	ResumeArgs     []string `json:"resumeargs,omitempty"`
}

type SessionEvent struct {
	Type string `json:"type"`
	Ts   int64  `json:"ts"`
	Text string `json:"text"`
}

type SessionActivity struct {
	ID             string         `json:"id"`
	Runtime        string         `json:"runtime"`
	ProjectPath    string         `json:"projectpath"`
	ProjectName    string         `json:"projectname"`
	Branch         string         `json:"branch"`
	Task           string         `json:"task"`
	Model          string         `json:"model"`
	TokensTotal    int            `json:"tokenstotal"`
	LastActiveTs   int64          `json:"lastactivets"`
	ResumeCommand  string         `json:"resumecommand"`
	ResumeArgs     []string       `json:"resumeargs,omitempty"`
	TranscriptPath string         `json:"transcriptpath"`
	Status         string         `json:"status"`
	StartedTs      int64          `json:"startedts"`
	DurationMs     int64          `json:"durationms"`
	Events         []SessionEvent `json:"events"`
	// set for a session an orchestrator run launched: the lead's run and channel, and for a child the task
	// it works. Role is lead | worker | review, or a stage session's plan-reviewer | verifier.
	RunId     string `json:"runid,omitempty"`
	ChannelId string `json:"channelid,omitempty"`
	TaskId    string `json:"taskid,omitempty"`
	Role      string `json:"role,omitempty"`
}

type PathCommandData struct {
	PathType     string `json:"pathtype"`
	OpenExternal bool   `json:"openexternal"`
}

type CommandGetRTInfoData struct {
	ORef waveobj.ORef `json:"oref"`
}

type CommandSetRTInfoData struct {
	ORef   waveobj.ORef   `json:"oref"`
	Data   map[string]any `json:"data" tstype:"ObjRTInfo"`
	Delete bool           `json:"delete,omitempty"`
}

type StreamMeta struct {
	Id            string `json:"id"`   // streamid
	RWnd          int64  `json:"rwnd"` // initial receive window size
	ReaderRouteId string `json:"readerrouteid"`
	WriterRouteId string `json:"writerrouteid"`
}

// ProcessInfo holds per-process information for the process viewer.
// Mem, MemPct, Cpu, and NumThreads are set to -1 when the data is unavailable
// (e.g. permission denied reading another user's process on macOS).
type ProcessInfo struct {
	Pid        int32   `json:"pid"`
	Ppid       int32   `json:"ppid,omitempty"`
	Command    string  `json:"command,omitempty"`
	Status     string  `json:"status,omitempty"`
	User       string  `json:"user,omitempty"`
	Mem        int64   `json:"mem"`        // resident set size in bytes; -1 if unavailable
	MemPct     float64 `json:"mempct"`     // memory percent; -1 if unavailable
	Cpu        float64 `json:"cpu"`        // cpu percent; -1 if unavailable
	NumThreads int32   `json:"numthreads"` // -1 if unavailable
	Gone       bool    `json:"gone,omitempty"`
}
