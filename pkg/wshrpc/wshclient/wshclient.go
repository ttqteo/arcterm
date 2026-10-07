// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Generated Code. DO NOT EDIT.

package wshclient

import (
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// command "acceptdossieredge", wshserver.AcceptDossierEdgeCommand
func AcceptDossierEdgeCommand(w *wshutil.WshRpc, data wshrpc.CommandDossierEdgeData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "acceptdossieredge", data, opts)
	return err
}

// command "ackrun", wshserver.AckRunCommand
func AckRunCommand(w *wshutil.WshRpc, data wshrpc.CommandAckRunData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "ackrun", data, opts)
	return err
}

// command "advancerun", wshserver.AdvanceRunCommand
func AdvanceRunCommand(w *wshutil.WshRpc, data wshrpc.CommandAdvanceRunData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "advancerun", data, opts)
	return err
}

// command "agentaskclear", wshserver.AgentAskClearCommand
func AgentAskClearCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "agentaskclear", data, opts)
	return err
}

// command "agentcontrol", wshserver.AgentControlCommand
func AgentControlCommand(w *wshutil.WshRpc, data wshrpc.CommandAgentControlData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.AgentControlMsg] {
	return sendRpcRequestResponseStreamHelper[wshrpc.AgentControlMsg](w, "agentcontrol", data, opts)
}

// command "agentsyncadopt", wshserver.AgentSyncAdoptCommand
func AgentSyncAdoptCommand(w *wshutil.WshRpc, data wshrpc.CommandAgentSyncAdoptData, opts *wshrpc.RpcOpts) (*wshrpc.CommandAgentSyncAdoptRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandAgentSyncAdoptRtnData](w, "agentsyncadopt", data, opts)
	return resp, err
}

// command "agentsyncapply", wshserver.AgentSyncApplyCommand
func AgentSyncApplyCommand(w *wshutil.WshRpc, data wshrpc.CommandAgentSyncApplyData, opts *wshrpc.RpcOpts) (*wshrpc.CommandAgentSyncApplyRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandAgentSyncApplyRtnData](w, "agentsyncapply", data, opts)
	return resp, err
}

// command "agentsyncskills", wshserver.AgentSyncSkillsCommand
func AgentSyncSkillsCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandAgentSyncSkillsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandAgentSyncSkillsRtnData](w, "agentsyncskills", nil, opts)
	return resp, err
}

// command "agentsyncstatus", wshserver.AgentSyncStatusCommand
func AgentSyncStatusCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandAgentSyncStatusRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandAgentSyncStatusRtnData](w, "agentsyncstatus", nil, opts)
	return resp, err
}

// command "agentsyncsteeringread", wshserver.AgentSyncSteeringReadCommand
func AgentSyncSteeringReadCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandAgentSyncSteeringReadRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandAgentSyncSteeringReadRtnData](w, "agentsyncsteeringread", nil, opts)
	return resp, err
}

// command "agentsyncsteeringwrite", wshserver.AgentSyncSteeringWriteCommand
func AgentSyncSteeringWriteCommand(w *wshutil.WshRpc, data wshrpc.CommandAgentSyncSteeringWriteData, opts *wshrpc.RpcOpts) (*wshrpc.CommandAgentSyncSteeringWriteRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandAgentSyncSteeringWriteRtnData](w, "agentsyncsteeringwrite", data, opts)
	return resp, err
}

// command "answeragent", wshserver.AnswerAgentCommand
func AnswerAgentCommand(w *wshutil.WshRpc, data wshrpc.CommandAnswerAgentData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "answeragent", data, opts)
	return err
}

// command "appenddossierdecision", wshserver.AppendDossierDecisionCommand
func AppendDossierDecisionCommand(w *wshutil.WshRpc, data wshrpc.CommandAppendDossierDecisionData, opts *wshrpc.RpcOpts) (*wshrpc.CommandAppendDossierDecisionRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandAppendDossierDecisionRtnData](w, "appenddossierdecision", data, opts)
	return resp, err
}

// command "ask", wshserver.AskCommand
func AskCommand(w *wshutil.WshRpc, data wshrpc.CommandAskData, opts *wshrpc.RpcOpts) (wshrpc.AskRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.AskRtnData](w, "ask", data, opts)
	return resp, err
}

// command "authenticate", wshserver.AuthenticateCommand
func AuthenticateCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (wshrpc.CommandAuthenticateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandAuthenticateRtnData](w, "authenticate", data, opts)
	return resp, err
}

// command "authenticatetoken", wshserver.AuthenticateTokenCommand
func AuthenticateTokenCommand(w *wshutil.WshRpc, data wshrpc.CommandAuthenticateTokenData, opts *wshrpc.RpcOpts) (wshrpc.CommandAuthenticateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandAuthenticateRtnData](w, "authenticatetoken", data, opts)
	return resp, err
}

// command "authenticatetokenverify", wshserver.AuthenticateTokenVerifyCommand
func AuthenticateTokenVerifyCommand(w *wshutil.WshRpc, data wshrpc.CommandAuthenticateTokenData, opts *wshrpc.RpcOpts) (wshrpc.CommandAuthenticateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandAuthenticateRtnData](w, "authenticatetokenverify", data, opts)
	return resp, err
}

// command "blockslist", wshserver.BlocksListCommand
func BlocksListCommand(w *wshutil.WshRpc, data wshrpc.BlocksListRequest, opts *wshrpc.RpcOpts) ([]wshrpc.BlocksListEntry, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.BlocksListEntry](w, "blockslist", data, opts)
	return resp, err
}

// command "cancelradarscan", wshserver.CancelRadarScanCommand
func CancelRadarScanCommand(w *wshutil.WshRpc, data wshrpc.CommandCancelRadarScanData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "cancelradarscan", data, opts)
	return err
}

// command "cancelrun", wshserver.CancelRunCommand
func CancelRunCommand(w *wshutil.WshRpc, data wshrpc.CommandCancelRunData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "cancelrun", data, opts)
	return err
}

// command "canvasserve", wshserver.CanvasServeCommand
func CanvasServeCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "canvasserve", data, opts)
	return resp, err
}

// command "consult", wshserver.ConsultCommand
func ConsultCommand(w *wshutil.WshRpc, data wshrpc.CommandConsultData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk] {
	return sendRpcRequestResponseStreamHelper[wshrpc.ConsultChunk](w, "consult", data, opts)
}

// command "controllerappendoutput", wshserver.ControllerAppendOutputCommand
func ControllerAppendOutputCommand(w *wshutil.WshRpc, data wshrpc.CommandControllerAppendOutputData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerappendoutput", data, opts)
	return err
}

// command "controllerdestroy", wshserver.ControllerDestroyCommand
func ControllerDestroyCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerdestroy", data, opts)
	return err
}

// command "controllerinput", wshserver.ControllerInputCommand
func ControllerInputCommand(w *wshutil.WshRpc, data wshrpc.CommandBlockInputData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerinput", data, opts)
	return err
}

// command "controllerresync", wshserver.ControllerResyncCommand
func ControllerResyncCommand(w *wshutil.WshRpc, data wshrpc.CommandControllerResyncData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerresync", data, opts)
	return err
}

// command "createblock", wshserver.CreateBlockCommand
func CreateBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateBlockData, opts *wshrpc.RpcOpts) (waveobj.ORef, error) {
	resp, err := sendRpcRequestCallHelper[waveobj.ORef](w, "createblock", data, opts)
	return resp, err
}

// command "createchannel", wshserver.CreateChannelCommand
func CreateChannelCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateChannelData, opts *wshrpc.RpcOpts) (*waveobj.Channel, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.Channel](w, "createchannel", data, opts)
	return resp, err
}

// command "createchildrun", wshserver.CreateChildRunCommand
func CreateChildRunCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateChildRunData, opts *wshrpc.RpcOpts) (*wshrpc.CommandCreateChildRunRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandCreateChildRunRtnData](w, "createchildrun", data, opts)
	return resp, err
}

// command "createproject", wshserver.CreateProjectCommand
func CreateProjectCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateProjectData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "createproject", data, opts)
	return err
}

// command "createrun", wshserver.CreateRunCommand
func CreateRunCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateRunData, opts *wshrpc.RpcOpts) (*wshrpc.CommandCreateRunRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandCreateRunRtnData](w, "createrun", data, opts)
	return resp, err
}

// command "createworktree", wshserver.CreateWorktreeCommand
func CreateWorktreeCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateWorktreeData, opts *wshrpc.RpcOpts) (wshrpc.CommandCreateWorktreeRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandCreateWorktreeRtnData](w, "createworktree", data, opts)
	return resp, err
}

// command "dagaction", wshserver.DagActionCommand
func DagActionCommand(w *wshutil.WshRpc, data wshrpc.CommandDagActionData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "dagaction", data, opts)
	return err
}

// command "daganswer", wshserver.DagAnswerCommand
func DagAnswerCommand(w *wshutil.WshRpc, data wshrpc.CommandDagAnswerData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "daganswer", data, opts)
	return err
}

// command "dagasks", wshserver.DagAsksCommand
func DagAsksCommand(w *wshutil.WshRpc, data wshrpc.CommandDagStatusData, opts *wshrpc.RpcOpts) (*wshrpc.CommandDagAsksRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandDagAsksRtnData](w, "dagasks", data, opts)
	return resp, err
}

// command "dagmerge", wshserver.DagMergeCommand
func DagMergeCommand(w *wshutil.WshRpc, data wshrpc.CommandDagMergeData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "dagmerge", data, opts)
	return err
}

// command "dagmergecontinue", wshserver.DagMergeContinueCommand
func DagMergeContinueCommand(w *wshutil.WshRpc, data wshrpc.CommandDagMergeData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "dagmergecontinue", data, opts)
	return err
}

// command "dagplanpreview", wshserver.DagPlanPreviewCommand
func DagPlanPreviewCommand(w *wshutil.WshRpc, data wshrpc.CommandDagPlanPreviewData, opts *wshrpc.RpcOpts) (*wshrpc.CommandDagPlanPreviewRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandDagPlanPreviewRtnData](w, "dagplanpreview", data, opts)
	return resp, err
}

// command "dagstatus", wshserver.DagStatusCommand
func DagStatusCommand(w *wshutil.WshRpc, data wshrpc.CommandDagStatusData, opts *wshrpc.RpcOpts) (*wshrpc.CommandDagStatusRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandDagStatusRtnData](w, "dagstatus", data, opts)
	return resp, err
}

// command "dagsubmit", wshserver.DagSubmitCommand
func DagSubmitCommand(w *wshutil.WshRpc, data wshrpc.CommandDagSubmitData, opts *wshrpc.RpcOpts) (*waveobj.TaskGroup, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.TaskGroup](w, "dagsubmit", data, opts)
	return resp, err
}

// command "deleteblock", wshserver.DeleteBlockCommand
func DeleteBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteBlockData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "deleteblock", data, opts)
	return err
}

// command "deletechannel", wshserver.DeleteChannelCommand
func DeleteChannelCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteChannelData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "deletechannel", data, opts)
	return err
}

// command "deleteproject", wshserver.DeleteProjectCommand
func DeleteProjectCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteProjectData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "deleteproject", data, opts)
	return err
}

// command "detachdossieredge", wshserver.DetachDossierEdgeCommand
func DetachDossierEdgeCommand(w *wshutil.WshRpc, data wshrpc.CommandDossierEdgeData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "detachdossieredge", data, opts)
	return err
}

// command "doccompile", wshserver.DocCompileCommand
func DocCompileCommand(w *wshutil.WshRpc, data wshrpc.CommandDocCompileData, opts *wshrpc.RpcOpts) (*wshrpc.CommandDocCompileRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandDocCompileRtnData](w, "doccompile", data, opts)
	return resp, err
}

// command "docpdffind", wshserver.DocPdfFindCommand
func DocPdfFindCommand(w *wshutil.WshRpc, data wshrpc.CommandDocPdfFindData, opts *wshrpc.RpcOpts) (*wshrpc.CommandDocPdfFindRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandDocPdfFindRtnData](w, "docpdffind", data, opts)
	return resp, err
}

// command "effortcreate", wshserver.EffortCreateCommand
func EffortCreateCommand(w *wshutil.WshRpc, data wshrpc.CommandEffortCreateData, opts *wshrpc.RpcOpts) (*wshrpc.CommandEffortCreateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandEffortCreateRtnData](w, "effortcreate", data, opts)
	return resp, err
}

// command "effortdelete", wshserver.EffortDeleteCommand
func EffortDeleteCommand(w *wshutil.WshRpc, data wshrpc.CommandEffortDeleteData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "effortdelete", data, opts)
	return err
}

// command "effortget", wshserver.EffortGetCommand
func EffortGetCommand(w *wshutil.WshRpc, data wshrpc.CommandEffortGetData, opts *wshrpc.RpcOpts) (*wshrpc.CommandEffortGetRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandEffortGetRtnData](w, "effortget", data, opts)
	return resp, err
}

// command "effortlist", wshserver.EffortListCommand
func EffortListCommand(w *wshutil.WshRpc, data wshrpc.CommandEffortListData, opts *wshrpc.RpcOpts) (*wshrpc.CommandEffortListRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandEffortListRtnData](w, "effortlist", data, opts)
	return resp, err
}

// command "effortmutate", wshserver.EffortMutateCommand
func EffortMutateCommand(w *wshutil.WshRpc, data wshrpc.CommandEffortMutateData, opts *wshrpc.RpcOpts) (*wshrpc.CommandEffortMutateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandEffortMutateRtnData](w, "effortmutate", data, opts)
	return resp, err
}

// command "eventpublish", wshserver.EventPublishCommand
func EventPublishCommand(w *wshutil.WshRpc, data wps.WaveEvent, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventpublish", data, opts)
	return err
}

// command "eventreadhistory", wshserver.EventReadHistoryCommand
func EventReadHistoryCommand(w *wshutil.WshRpc, data wshrpc.CommandEventReadHistoryData, opts *wshrpc.RpcOpts) ([]*wps.WaveEvent, error) {
	resp, err := sendRpcRequestCallHelper[[]*wps.WaveEvent](w, "eventreadhistory", data, opts)
	return resp, err
}

// command "eventrecv", wshserver.EventRecvCommand
func EventRecvCommand(w *wshutil.WshRpc, data wps.WaveEvent, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventrecv", data, opts)
	return err
}

// command "eventsub", wshserver.EventSubCommand
func EventSubCommand(w *wshutil.WshRpc, data wps.SubscriptionRequest, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventsub", data, opts)
	return err
}

// command "eventunsub", wshserver.EventUnsubCommand
func EventUnsubCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventunsub", data, opts)
	return err
}

// command "filecreate", wshserver.FileCreateCommand
func FileCreateCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filecreate", data, opts)
	return err
}

// command "filedelete", wshserver.FileDeleteCommand
func FileDeleteCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteFileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filedelete", data, opts)
	return err
}

// command "fileinfo", wshserver.FileInfoCommand
func FileInfoCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "fileinfo", data, opts)
	return resp, err
}

// command "filejoin", wshserver.FileJoinCommand
func FileJoinCommand(w *wshutil.WshRpc, data []string, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "filejoin", data, opts)
	return resp, err
}

// command "filemkdir", wshserver.FileMkdirCommand
func FileMkdirCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filemkdir", data, opts)
	return err
}

// command "filemove", wshserver.FileMoveCommand
func FileMoveCommand(w *wshutil.WshRpc, data wshrpc.CommandFileCopyData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filemove", data, opts)
	return err
}

// command "fileread", wshserver.FileReadCommand
func FileReadCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) (*wshrpc.FileData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileData](w, "fileread", data, opts)
	return resp, err
}

// command "filewrite", wshserver.FileWriteCommand
func FileWriteCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filewrite", data, opts)
	return err
}

// command "getagenttranscript", wshserver.GetAgentTranscriptCommand
func GetAgentTranscriptCommand(w *wshutil.WshRpc, data wshrpc.CommandGetAgentTranscriptData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetAgentTranscriptRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetAgentTranscriptRtnData](w, "getagenttranscript", data, opts)
	return resp, err
}

// command "getallbadges", wshserver.GetAllBadgesCommand
func GetAllBadgesCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]baseds.BadgeEvent, error) {
	resp, err := sendRpcRequestCallHelper[[]baseds.BadgeEvent](w, "getallbadges", nil, opts)
	return resp, err
}

// command "getattention", wshserver.GetAttentionCommand
func GetAttentionCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetAttentionRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetAttentionRtnData](w, "getattention", nil, opts)
	return resp, err
}

// command "getbackgroundagents", wshserver.GetBackgroundAgentsCommand
func GetBackgroundAgentsCommand(w *wshutil.WshRpc, data wshrpc.CommandGetBackgroundAgentsData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetBackgroundAgentsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetBackgroundAgentsRtnData](w, "getbackgroundagents", data, opts)
	return resp, err
}

// command "getcachestatus", wshserver.GetCacheStatusCommand
func GetCacheStatusCommand(w *wshutil.WshRpc, data wshrpc.CommandGetCacheStatusData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetCacheStatusRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetCacheStatusRtnData](w, "getcachestatus", data, opts)
	return resp, err
}

// command "getchannelmessages", wshserver.GetChannelMessagesCommand
func GetChannelMessagesCommand(w *wshutil.WshRpc, data wshrpc.CommandGetChannelMessagesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetChannelMessagesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetChannelMessagesRtnData](w, "getchannelmessages", data, opts)
	return resp, err
}

// command "getchannelruns", wshserver.GetChannelRunsCommand
func GetChannelRunsCommand(w *wshutil.WshRpc, data wshrpc.CommandGetChannelRunsData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetChannelRunsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetChannelRunsRtnData](w, "getchannelruns", data, opts)
	return resp, err
}

// command "getchannels", wshserver.GetChannelsCommand
func GetChannelsCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetChannelsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetChannelsRtnData](w, "getchannels", nil, opts)
	return resp, err
}

// command "getclaudequota", wshserver.GetClaudeQuotaCommand
func GetClaudeQuotaCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetClaudeQuotaRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetClaudeQuotaRtnData](w, "getclaudequota", nil, opts)
	return resp, err
}

// command "getdossier", wshserver.GetDossierCommand
func GetDossierCommand(w *wshutil.WshRpc, data wshrpc.CommandGetDossierData, opts *wshrpc.RpcOpts) (*wshrpc.DossierDetail, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.DossierDetail](w, "getdossier", data, opts)
	return resp, err
}

// command "getfullconfig", wshserver.GetFullConfigCommand
func GetFullConfigCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (wconfig.FullConfigType, error) {
	resp, err := sendRpcRequestCallHelper[wconfig.FullConfigType](w, "getfullconfig", nil, opts)
	return resp, err
}

// command "getglobalprofile", wshserver.GetGlobalProfileCommand
func GetGlobalProfileCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*waveobj.JarvisProfile, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.JarvisProfile](w, "getglobalprofile", nil, opts)
	return resp, err
}

// command "getjarvisprofile", wshserver.GetJarvisProfileCommand
func GetJarvisProfileCommand(w *wshutil.WshRpc, data wshrpc.CommandGetJarvisProfileData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetJarvisProfileRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetJarvisProfileRtnData](w, "getjarvisprofile", data, opts)
	return resp, err
}

// command "getlatestresume", wshserver.GetLatestResumeCommand
func GetLatestResumeCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetLatestResumeRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetLatestResumeRtnData](w, "getlatestresume", nil, opts)
	return resp, err
}

// command "getmeta", wshserver.GetMetaCommand
func GetMetaCommand(w *wshutil.WshRpc, data wshrpc.CommandGetMetaData, opts *wshrpc.RpcOpts) (waveobj.MetaMapType, error) {
	resp, err := sendRpcRequestCallHelper[waveobj.MetaMapType](w, "getmeta", data, opts)
	return resp, err
}

// command "getrecentsessions", wshserver.GetRecentSessionsCommand
func GetRecentSessionsCommand(w *wshutil.WshRpc, data wshrpc.CommandGetRecentSessionsData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetRecentSessionsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetRecentSessionsRtnData](w, "getrecentsessions", data, opts)
	return resp, err
}

// command "getrtinfo", wshserver.GetRTInfoCommand
func GetRTInfoCommand(w *wshutil.WshRpc, data wshrpc.CommandGetRTInfoData, opts *wshrpc.RpcOpts) (*waveobj.ObjRTInfo, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.ObjRTInfo](w, "getrtinfo", data, opts)
	return resp, err
}

// command "getsecretsnames", wshserver.GetSecretsNamesCommand
func GetSecretsNamesCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]string, error) {
	resp, err := sendRpcRequestCallHelper[[]string](w, "getsecretsnames", nil, opts)
	return resp, err
}

// command "getsessiongroup", wshserver.GetSessionGroupCommand
func GetSessionGroupCommand(w *wshutil.WshRpc, data wshrpc.CommandGetSessionGroupData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetSessionGroupRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetSessionGroupRtnData](w, "getsessiongroup", data, opts)
	return resp, err
}

// command "getsessionsactivity", wshserver.GetSessionsActivityCommand
func GetSessionsActivityCommand(w *wshutil.WshRpc, data wshrpc.CommandGetSessionsActivityData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetSessionsActivityRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetSessionsActivityRtnData](w, "getsessionsactivity", data, opts)
	return resp, err
}

// command "getsubagents", wshserver.GetSubagentsCommand
func GetSubagentsCommand(w *wshutil.WshRpc, data wshrpc.CommandGetSubagentsData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetSubagentsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetSubagentsRtnData](w, "getsubagents", data, opts)
	return resp, err
}

// command "gettranscripttokens", wshserver.GetTranscriptTokensCommand
func GetTranscriptTokensCommand(w *wshutil.WshRpc, data wshrpc.CommandGetTranscriptTokensData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetTranscriptTokensRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetTranscriptTokensRtnData](w, "gettranscripttokens", data, opts)
	return resp, err
}

// command "gettranscriptusage", wshserver.GetTranscriptUsageCommand
func GetTranscriptUsageCommand(w *wshutil.WshRpc, data wshrpc.CommandGetTranscriptUsageData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetTranscriptUsageRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetTranscriptUsageRtnData](w, "gettranscriptusage", data, opts)
	return resp, err
}

// command "getusagestats", wshserver.GetUsageStatsCommand
func GetUsageStatsCommand(w *wshutil.WshRpc, data wshrpc.CommandGetUsageStatsData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetUsageStatsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetUsageStatsRtnData](w, "getusagestats", data, opts)
	return resp, err
}

// command "getwindowtokens", wshserver.GetWindowTokensCommand
func GetWindowTokensCommand(w *wshutil.WshRpc, data wshrpc.CommandGetWindowTokensData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetWindowTokensRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetWindowTokensRtnData](w, "getwindowtokens", data, opts)
	return resp, err
}

// command "getworkercapacity", wshserver.GetWorkerCapacityCommand
func GetWorkerCapacityCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetWorkerCapacityRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGetWorkerCapacityRtnData](w, "getworkercapacity", nil, opts)
	return resp, err
}

// command "gitchanges", wshserver.GitChangesCommand
func GitChangesCommand(w *wshutil.WshRpc, data wshrpc.CommandGitChangesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitChangesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitChangesRtnData](w, "gitchanges", data, opts)
	return resp, err
}

// command "gitcommitchanges", wshserver.GitCommitChangesCommand
func GitCommitChangesCommand(w *wshutil.WshRpc, data wshrpc.CommandGitCommitChangesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitCommitChangesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitCommitChangesRtnData](w, "gitcommitchanges", data, opts)
	return resp, err
}

// command "gitcomparechanges", wshserver.GitCompareChangesCommand
func GitCompareChangesCommand(w *wshutil.WshRpc, data wshrpc.CommandGitCompareChangesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitCompareChangesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitCompareChangesRtnData](w, "gitcomparechanges", data, opts)
	return resp, err
}

// command "gitdivergence", wshserver.GitDivergenceCommand
func GitDivergenceCommand(w *wshutil.WshRpc, data wshrpc.CommandGitDivergenceData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitDivergenceRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitDivergenceRtnData](w, "gitdivergence", data, opts)
	return resp, err
}

// command "gitfetch", wshserver.GitFetchCommand
func GitFetchCommand(w *wshutil.WshRpc, data wshrpc.CommandGitFetchData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitFetchRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitFetchRtnData](w, "gitfetch", data, opts)
	return resp, err
}

// command "gitfileatref", wshserver.GitFileAtRefCommand
func GitFileAtRefCommand(w *wshutil.WshRpc, data wshrpc.CommandGitFileAtRefData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitFileAtRefRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitFileAtRefRtnData](w, "gitfileatref", data, opts)
	return resp, err
}

// command "gitgrep", wshserver.GitGrepCommand
func GitGrepCommand(w *wshutil.WshRpc, data wshrpc.CommandGitGrepData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitGrepRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitGrepRtnData](w, "gitgrep", data, opts)
	return resp, err
}

// command "githistory", wshserver.GitHistoryCommand
func GitHistoryCommand(w *wshutil.WshRpc, data wshrpc.CommandGitHistoryData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitHistoryRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitHistoryRtnData](w, "githistory", data, opts)
	return resp, err
}

// command "gitlistfiles", wshserver.GitListFilesCommand
func GitListFilesCommand(w *wshutil.WshRpc, data wshrpc.CommandGitListFilesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitListFilesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitListFilesRtnData](w, "gitlistfiles", data, opts)
	return resp, err
}

// command "gitlistignoreddir", wshserver.GitListIgnoredDirCommand
func GitListIgnoredDirCommand(w *wshutil.WshRpc, data wshrpc.CommandGitListIgnoredDirData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitListIgnoredDirRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitListIgnoredDirRtnData](w, "gitlistignoreddir", data, opts)
	return resp, err
}

// command "gitlistworktrees", wshserver.GitListWorktreesCommand
func GitListWorktreesCommand(w *wshutil.WshRpc, data wshrpc.CommandGitListWorktreesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitListWorktreesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitListWorktreesRtnData](w, "gitlistworktrees", data, opts)
	return resp, err
}

// command "gitrevert", wshserver.GitRevertCommand
func GitRevertCommand(w *wshutil.WshRpc, data wshrpc.CommandGitRevertData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "gitrevert", data, opts)
	return err
}

// command "gitreviewpatch", wshserver.GitReviewPatchCommand
func GitReviewPatchCommand(w *wshutil.WshRpc, data wshrpc.CommandGitReviewPatchData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGitReviewPatchRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandGitReviewPatchRtnData](w, "gitreviewpatch", data, opts)
	return resp, err
}

// command "jarvisctx", wshserver.JarvisCtxCommand
func JarvisCtxCommand(w *wshutil.WshRpc, data wshrpc.CommandJarvisCtxData, opts *wshrpc.RpcOpts) (*wshrpc.CommandJarvisCtxRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandJarvisCtxRtnData](w, "jarvisctx", data, opts)
	return resp, err
}

// command "jarvisrunevents", wshserver.JarvisRunEventsCommand
func JarvisRunEventsCommand(w *wshutil.WshRpc, data wshrpc.CommandJarvisRunEventsData, opts *wshrpc.RpcOpts) (*wshrpc.CommandJarvisRunEventsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandJarvisRunEventsRtnData](w, "jarvisrunevents", data, opts)
	return resp, err
}

// command "jarvisstate", wshserver.JarvisStateCommand
func JarvisStateCommand(w *wshutil.WshRpc, data wshrpc.CommandJarvisStateData, opts *wshrpc.RpcOpts) (*wshrpc.CommandJarvisStateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandJarvisStateRtnData](w, "jarvisstate", data, opts)
	return resp, err
}

// command "jarvisstatus", wshserver.JarvisStatusCommand
func JarvisStatusCommand(w *wshutil.WshRpc, data wshrpc.CommandJarvisStatusData, opts *wshrpc.RpcOpts) (*wshrpc.CommandJarvisStatusRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandJarvisStatusRtnData](w, "jarvisstatus", data, opts)
	return resp, err
}

// command "landrun", wshserver.LandRunCommand
func LandRunCommand(w *wshutil.WshRpc, data wshrpc.CommandLandRunData, opts *wshrpc.RpcOpts) (*waveobj.RunLand, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.RunLand](w, "landrun", data, opts)
	return resp, err
}

// command "listbranches", wshserver.ListBranchesCommand
func ListBranchesCommand(w *wshutil.WshRpc, data wshrpc.CommandListBranchesData, opts *wshrpc.RpcOpts) (wshrpc.CommandListBranchesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandListBranchesRtnData](w, "listbranches", data, opts)
	return resp, err
}

// command "listdetachededges", wshserver.ListDetachedEdgesCommand
func ListDetachedEdgesCommand(w *wshutil.WshRpc, data wshrpc.CommandListDetachedEdgesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandListDetachedEdgesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandListDetachedEdgesRtnData](w, "listdetachededges", data, opts)
	return resp, err
}

// command "listdossiers", wshserver.ListDossiersCommand
func ListDossiersCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandListDossiersRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandListDossiersRtnData](w, "listdossiers", nil, opts)
	return resp, err
}

// command "listharnesses", wshserver.ListHarnessesCommand
func ListHarnessesCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandListHarnessesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandListHarnessesRtnData](w, "listharnesses", nil, opts)
	return resp, err
}

// command "listradarreports", wshserver.ListRadarReportsCommand
func ListRadarReportsCommand(w *wshutil.WshRpc, data wshrpc.CommandListRadarReportsData, opts *wshrpc.RpcOpts) (*wshrpc.CommandListRadarReportsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandListRadarReportsRtnData](w, "listradarreports", data, opts)
	return resp, err
}

// command "listtaskdossiers", wshserver.ListTaskDossiersCommand
func ListTaskDossiersCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandListTaskDossiersRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandListTaskDossiersRtnData](w, "listtaskdossiers", nil, opts)
	return resp, err
}

// command "message", wshserver.MessageCommand
func MessageCommand(w *wshutil.WshRpc, data wshrpc.CommandMessageData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "message", data, opts)
	return err
}

// command "notify", wshserver.NotifyCommand
func NotifyCommand(w *wshutil.WshRpc, data wshrpc.NotifyCommandData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "notify", data, opts)
	return err
}

// command "path", wshserver.PathCommand
func PathCommand(w *wshutil.WshRpc, data wshrpc.PathCommandData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "path", data, opts)
	return resp, err
}

// command "postchannelmessage", wshserver.PostChannelMessageCommand
func PostChannelMessageCommand(w *wshutil.WshRpc, data wshrpc.CommandPostChannelMessageData, opts *wshrpc.RpcOpts) (*waveobj.ChannelMessage, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.ChannelMessage](w, "postchannelmessage", data, opts)
	return resp, err
}

// command "readvaultnote", wshserver.ReadVaultNoteCommand
func ReadVaultNoteCommand(w *wshutil.WshRpc, data wshrpc.CommandReadVaultNoteData, opts *wshrpc.RpcOpts) (*wshrpc.CommandReadVaultNoteRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandReadVaultNoteRtnData](w, "readvaultnote", data, opts)
	return resp, err
}

// command "refreshroutecatalog", wshserver.RefreshRouteCatalogCommand
func RefreshRouteCatalogCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "refreshroutecatalog", nil, opts)
	return err
}

// command "remotefilecopy", wshserver.RemoteFileCopyCommand
func RemoteFileCopyCommand(w *wshutil.WshRpc, data wshrpc.CommandFileCopyData, opts *wshrpc.RpcOpts) (bool, error) {
	resp, err := sendRpcRequestCallHelper[bool](w, "remotefilecopy", data, opts)
	return resp, err
}

// command "remotefiledelete", wshserver.RemoteFileDeleteCommand
func RemoteFileDeleteCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteFileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotefiledelete", data, opts)
	return err
}

// command "remotefileinfo", wshserver.RemoteFileInfoCommand
func RemoteFileInfoCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "remotefileinfo", data, opts)
	return resp, err
}

// command "remotefilejoin", wshserver.RemoteFileJoinCommand
func RemoteFileJoinCommand(w *wshutil.WshRpc, data []string, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "remotefilejoin", data, opts)
	return resp, err
}

// command "remotefilemove", wshserver.RemoteFileMoveCommand
func RemoteFileMoveCommand(w *wshutil.WshRpc, data wshrpc.CommandFileCopyData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotefilemove", data, opts)
	return err
}

// command "remotefilestream", wshserver.RemoteFileStreamCommand
func RemoteFileStreamCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteFileStreamData, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "remotefilestream", data, opts)
	return resp, err
}

// command "remotelistentries", wshserver.RemoteListEntriesCommand
func RemoteListEntriesCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteListEntriesData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.CommandRemoteListEntriesRtnData](w, "remotelistentries", data, opts)
}

// command "remotemkdir", wshserver.RemoteMkdirCommand
func RemoteMkdirCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotemkdir", data, opts)
	return err
}

// command "remotewritefile", wshserver.RemoteWriteFileCommand
func RemoteWriteFileCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotewritefile", data, opts)
	return err
}

// command "removebackgroundagent", wshserver.RemoveBackgroundAgentCommand
func RemoveBackgroundAgentCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoveBackgroundAgentData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "removebackgroundagent", data, opts)
	return err
}

// command "reportrunphase", wshserver.ReportRunPhaseCommand
func ReportRunPhaseCommand(w *wshutil.WshRpc, data wshrpc.CommandReportRunPhaseData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "reportrunphase", data, opts)
	return err
}

// command "resolveambient", wshserver.ResolveAmbientCommand
func ResolveAmbientCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandResolveAmbientRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandResolveAmbientRtnData](w, "resolveambient", nil, opts)
	return resp, err
}

// command "resolvedossieredges", wshserver.ResolveDossierEdgesCommand
func ResolveDossierEdgesCommand(w *wshutil.WshRpc, data wshrpc.CommandResolveDossierEdgesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandResolveDossierEdgesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandResolveDossierEdgesRtnData](w, "resolvedossieredges", data, opts)
	return resp, err
}

// command "resolvefocusscope", wshserver.ResolveFocusScopeCommand
func ResolveFocusScopeCommand(w *wshutil.WshRpc, data wshrpc.CommandResolveFocusScopeData, opts *wshrpc.RpcOpts) (*wshrpc.SpaceScope, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.SpaceScope](w, "resolvefocusscope", data, opts)
	return resp, err
}

// command "resolveids", wshserver.ResolveIdsCommand
func ResolveIdsCommand(w *wshutil.WshRpc, data wshrpc.CommandResolveIdsData, opts *wshrpc.RpcOpts) (wshrpc.CommandResolveIdsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandResolveIdsRtnData](w, "resolveids", data, opts)
	return resp, err
}

// command "retryradarclustering", wshserver.RetryRadarClusteringCommand
func RetryRadarClusteringCommand(w *wshutil.WshRpc, data wshrpc.CommandRetryRadarClusteringData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "retryradarclustering", data, opts)
	return err
}

// command "routeannounce", wshserver.RouteAnnounceCommand
func RouteAnnounceCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "routeannounce", nil, opts)
	return err
}

// command "routeunannounce", wshserver.RouteUnannounceCommand
func RouteUnannounceCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "routeunannounce", nil, opts)
	return err
}

// command "runanswer", wshserver.RunAnswerCommand
func RunAnswerCommand(w *wshutil.WshRpc, data wshrpc.CommandRunAnswerData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "runanswer", data, opts)
	return err
}

// command "runasks", wshserver.RunAsksCommand
func RunAsksCommand(w *wshutil.WshRpc, data wshrpc.CommandRunAskData, opts *wshrpc.RpcOpts) (*wshrpc.CommandDagAsksRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandDagAsksRtnData](w, "runasks", data, opts)
	return resp, err
}

// command "runtranscriptpath", wshserver.RunTranscriptPathCommand
func RunTranscriptPathCommand(w *wshutil.WshRpc, data wshrpc.CommandRunTranscriptPathData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "runtranscriptpath", data, opts)
	return resp, err
}

// command "runusage", wshserver.RunUsageCommand
func RunUsageCommand(w *wshutil.WshRpc, data wshrpc.CommandRunUsageData, opts *wshrpc.RpcOpts) (*wshrpc.CommandRunUsageRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandRunUsageRtnData](w, "runusage", data, opts)
	return resp, err
}

// command "scanclaudeprojects", wshserver.ScanClaudeProjectsCommand
func ScanClaudeProjectsCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandScanClaudeProjectsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandScanClaudeProjectsRtnData](w, "scanclaudeprojects", nil, opts)
	return resp, err
}

// command "sealrunevidence", wshserver.SealRunEvidenceCommand
func SealRunEvidenceCommand(w *wshutil.WshRpc, data wshrpc.CommandSealRunEvidenceData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "sealrunevidence", data, opts)
	return err
}

// command "setchannelprofile", wshserver.SetChannelProfileCommand
func SetChannelProfileCommand(w *wshutil.WshRpc, data wshrpc.CommandSetChannelProfileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setchannelprofile", data, opts)
	return err
}

// command "setchannelread", wshserver.SetChannelReadCommand
func SetChannelReadCommand(w *wshutil.WshRpc, data wshrpc.CommandSetChannelReadData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setchannelread", data, opts)
	return err
}

// command "setchanneltier", wshserver.SetChannelTierCommand
func SetChannelTierCommand(w *wshutil.WshRpc, data wshrpc.CommandSetChannelTierData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setchanneltier", data, opts)
	return err
}

// command "setconfig", wshserver.SetConfigCommand
func SetConfigCommand(w *wshutil.WshRpc, data wshrpc.MetaSettingsType, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setconfig", data, opts)
	return err
}

// command "setdossierstatus", wshserver.SetDossierStatusCommand
func SetDossierStatusCommand(w *wshutil.WshRpc, data wshrpc.CommandSetDossierStatusData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setdossierstatus", data, opts)
	return err
}

// command "setglobalprofile", wshserver.SetGlobalProfileCommand
func SetGlobalProfileCommand(w *wshutil.WshRpc, data wshrpc.CommandSetGlobalProfileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setglobalprofile", data, opts)
	return err
}

// command "setmeta", wshserver.SetMetaCommand
func SetMetaCommand(w *wshutil.WshRpc, data wshrpc.CommandSetMetaData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setmeta", data, opts)
	return err
}

// command "setpeerinfo", wshserver.SetPeerInfoCommand
func SetPeerInfoCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setpeerinfo", data, opts)
	return err
}

// command "setradarfindingdisposition", wshserver.SetRadarFindingDispositionCommand
func SetRadarFindingDispositionCommand(w *wshutil.WshRpc, data wshrpc.CommandSetRadarFindingDispositionData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setradarfindingdisposition", data, opts)
	return err
}

// command "setrtinfo", wshserver.SetRTInfoCommand
func SetRTInfoCommand(w *wshutil.WshRpc, data wshrpc.CommandSetRTInfoData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setrtinfo", data, opts)
	return err
}

// command "setrunsettings", wshserver.SetRunSettingsCommand
func SetRunSettingsCommand(w *wshutil.WshRpc, data wshrpc.CommandSetRunSettingsData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setrunsettings", data, opts)
	return err
}

// command "setsecrets", wshserver.SetSecretsCommand
func SetSecretsCommand(w *wshutil.WshRpc, data map[string]*string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setsecrets", data, opts)
	return err
}

// command "startradarscan", wshserver.StartRadarScanCommand
func StartRadarScanCommand(w *wshutil.WshRpc, data wshrpc.CommandStartRadarScanData, opts *wshrpc.RpcOpts) (*wshrpc.CommandStartRadarScanRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandStartRadarScanRtnData](w, "startradarscan", data, opts)
	return resp, err
}

// command "stoprunworker", wshserver.StopRunWorkerCommand
func StopRunWorkerCommand(w *wshutil.WshRpc, data wshrpc.CommandStopRunWorkerData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "stoprunworker", data, opts)
	return err
}

// command "streamagenttranscript", wshserver.StreamAgentTranscriptCommand
func StreamAgentTranscriptCommand(w *wshutil.WshRpc, data wshrpc.CommandStreamAgentTranscriptData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate] {
	return sendRpcRequestResponseStreamHelper[wshrpc.AgentTranscriptUpdate](w, "streamagenttranscript", data, opts)
}

// command "streamdata", wshserver.StreamDataCommand
func StreamDataCommand(w *wshutil.WshRpc, data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "streamdata", data, opts)
	return err
}

// command "streamdataack", wshserver.StreamDataAckCommand
func StreamDataAckCommand(w *wshutil.WshRpc, data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "streamdataack", data, opts)
	return err
}

// command "termgetscrollbacklines", wshserver.TermGetScrollbackLinesCommand
func TermGetScrollbackLinesCommand(w *wshutil.WshRpc, data wshrpc.CommandTermGetScrollbackLinesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandTermGetScrollbackLinesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandTermGetScrollbackLinesRtnData](w, "termgetscrollbacklines", data, opts)
	return resp, err
}

// command "uiinvoke", wshserver.UiInvokeCommand
func UiInvokeCommand(w *wshutil.WshRpc, data wshrpc.CommandUiInvokeData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "uiinvoke", data, opts)
	return resp, err
}

// command "uireveal", wshserver.UiRevealCommand
func UiRevealCommand(w *wshutil.WshRpc, data wshrpc.CommandUiRevealData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "uireveal", data, opts)
	return resp, err
}

// command "uistate", wshserver.UiStateCommand
func UiStateCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.UiState, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.UiState](w, "uistate", nil, opts)
	return resp, err
}

// command "updateharness", wshserver.UpdateHarnessCommand
func UpdateHarnessCommand(w *wshutil.WshRpc, data wshrpc.CommandUpdateHarnessData, opts *wshrpc.RpcOpts) (*wshrpc.CommandUpdateHarnessRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandUpdateHarnessRtnData](w, "updateharness", data, opts)
	return resp, err
}

// command "updateworkspacetabids", wshserver.UpdateWorkspaceTabIdsCommand
func UpdateWorkspaceTabIdsCommand(w *wshutil.WshRpc, arg1 string, arg2 []string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "updateworkspacetabids", wshrpc.MultiArg{Args: []any{arg1, arg2}}, opts)
	return err
}

// command "vaultgraph", wshserver.VaultGraphCommand
func VaultGraphCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.CommandVaultGraphRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandVaultGraphRtnData](w, "vaultgraph", nil, opts)
	return resp, err
}

// command "vaultsetremote", wshserver.VaultSetRemoteCommand
func VaultSetRemoteCommand(w *wshutil.WshRpc, data wshrpc.CommandVaultSetRemoteData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "vaultsetremote", data, opts)
	return err
}

// command "vaultstatus", wshserver.VaultStatusCommand
func VaultStatusCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.VaultStatusRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.VaultStatusRtnData](w, "vaultstatus", nil, opts)
	return resp, err
}

// command "vaultsync", wshserver.VaultSyncCommand
func VaultSyncCommand(w *wshutil.WshRpc, data wshrpc.CommandVaultSyncData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "vaultsync", data, opts)
	return err
}

// command "waveinfo", wshserver.WaveInfoCommand
func WaveInfoCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.WaveInfoData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.WaveInfoData](w, "waveinfo", nil, opts)
	return resp, err
}

// command "workspacelist", wshserver.WorkspaceListCommand
func WorkspaceListCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]wshrpc.WorkspaceInfoData, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.WorkspaceInfoData](w, "workspacelist", nil, opts)
	return resp, err
}

// command "writetempfile", wshserver.WriteTempFileCommand
func WriteTempFileCommand(w *wshutil.WshRpc, data wshrpc.CommandWriteTempFileData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "writetempfile", data, opts)
	return resp, err
}


