// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the bug-reports row's two buttons do (attentionact.ts: "process-reports" and "pick-repo"). Process starts one
// "Báo lỗi arcterm" agent in arcterm's own repo with the waiting reports to read, then claims them for it; the folder
// picker keeps the repo the person chose and registers it as a project. The Brief, the Cockpit's Needs-you strip and
// anything else that lists the row call these, so the three places cannot disagree
// (docs/superpowers/specs/2026-11-19-bug-report-design.md, "Process" and "The repo").

import { launchAgent, type LaunchAgentOpts } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { loadAttention } from "@/app/view/agents/attentionstore";
import { harnessesAtom, harnessPreferenceAtom, resolveDefaultRuntime } from "@/app/view/agents/harnessstore";
import { composeStartupCommand, runtimeStartupCommand, type Runtime } from "@/app/view/agents/launch";
import { naFlagsAtom } from "@/app/view/agents/naflagsstore";
import { projectsAtom, registerProject } from "@/app/view/agents/projectsstore";
import { bugReportPrompt } from "./bugreportprompt";
import { newRepoProjectName, projectAtPath } from "./bugreportrepo";

// the agent's name in the roster and the Agent tree
export const BUG_REPORT_AGENT_LABEL = "Báo lỗi arcterm";

// the harness a launch falls back to when none is preferred and the catalog has not loaded yet (as initiativeworkaction.ts)
const FALLBACK_RUNTIME: Runtime = "claude";

declare global {
    interface Window {
        // DEV: a CDP scenario starts the "agent" itself (a plain terminal tab it made, so no real Claude agent runs) and
        // answers with that tab's id, the way __chatSuggestFake answers the chip call
        __bugReportLaunchFake?: (opts: LaunchAgentOpts) => string | Promise<string>;
        // DEV: a CDP scenario answers the folder dialog (null is a cancelled one)
        __bugReportPickFake?: () => string | null | Promise<string | null>;
    }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// a second press while the first is still starting (the launch takes a moment) would start a second agent for the same reports
let processing = false;
let picking = false;

/** Registers the project at path when none is, under the folder's name; the name of the project at path either way. */
export async function ensureRepoProject(path: string): Promise<string> {
    const registry = globalStore.get(projectsAtom);
    const have = projectAtPath(registry, path);
    if (have != null) {
        return have;
    }
    const name = newRepoProjectName(registry, path);
    await registerProject(name, path);
    return name;
}

// the launcher the DEV fake stands in for; a build without DEV never reads the window
function launcher(): (model: AgentsViewModel, opts: LaunchAgentOpts) => Promise<string> {
    const fake = import.meta.env.DEV && typeof window !== "undefined" ? window.__bugReportLaunchFake : undefined;
    return fake != null ? async (_model, opts) => fake(opts) : launchAgent;
}

/**
 * Xử lý: one agent reads every waiting report. A failed launch claims nothing; a failed claim leaves the agent open (its
 * prompt says to stop when `wsh bugreport list --state handling` does not show its reports) and says so.
 */
export async function processBugReports(model: AgentsViewModel): Promise<void> {
    if (processing) {
        return;
    }
    processing = true;
    try {
        await runProcess(model);
    } finally {
        processing = false;
        await loadAttention().catch(() => {});
    }
}

async function runProcess(model: AgentsViewModel): Promise<void> {
    let status: BugReportStatus;
    let reports: BugReport[];
    try {
        status = await RpcApi.BugReportStatusCommand(TabRpcClient);
        if (status.handling > 0) {
            // two agents never hold the same reports: the row reads Mở agent while one does
            pushToast({
                title: `Đang xử lý ${status.handling} báo lỗi`,
                message:
                    "Một agent đang giữ các báo lỗi này. Mở agent đó, hoặc đóng nó để các báo lỗi quay lại hàng chờ.",
                level: "warn",
            });
            return;
        }
        if (!status.repopath) {
            pushToast({
                title: "Không tìm thấy repo arcterm",
                message: "Chọn thư mục arcterm trước khi xử lý.",
                level: "error",
            });
            return;
        }
        reports = await RpcApi.BugReportListCommand(TabRpcClient, { state: "waiting" });
    } catch (e) {
        pushToast({ title: "Không đọc được các báo lỗi", message: errText(e), level: "error" });
        return;
    }
    if (reports.length === 0) {
        pushToast({ title: "Không có báo lỗi nào đang chờ", message: "", level: "info" });
        return;
    }
    const repoPath = status.repopath;
    let project: string;
    try {
        // the setting may have been written by hand, or its project removed since: an agent, a run and an initiative
        // all need a registered project, so it is registered first
        project = status.repoproject || (await ensureRepoProject(repoPath));
    } catch (e) {
        pushToast({ title: `Không đăng ký được thư mục ${repoPath} làm project`, message: errText(e), level: "error" });
        return;
    }
    const pref = globalStore.get(harnessPreferenceAtom).route?.runtime ?? "";
    const runtime = (resolveDefaultRuntime(pref, globalStore.get(harnessesAtom)) || FALLBACK_RUNTIME) as Runtime;
    let tabId: string;
    try {
        tabId = await launcher()(model, {
            runtime,
            // the flags New Agent remembers (e.g. skip permissions) apply here too
            startupCommand: composeStartupCommand(
                runtimeStartupCommand(runtime),
                runtime,
                globalStore.get(naFlagsAtom)[runtime] ?? {}
            ),
            task: bugReportPrompt({ repoPath, project, reports }),
            projectPath: repoPath,
            projectName: project,
            label: BUG_REPORT_AGENT_LABEL,
        });
    } catch (e) {
        pushToast({ title: "Không mở được agent xử lý báo lỗi", message: errText(e), level: "error" });
        return;
    }
    try {
        await RpcApi.BugReportClaimCommand(TabRpcClient, { agentid: tabId, ids: reports.map((r) => r.id) });
    } catch (e) {
        pushToast({
            title: "Agent đã mở nhưng chưa giữ được các báo lỗi",
            message: errText(e),
            level: "error",
        });
    }
}

/**
 * Chọn thư mục…: the Tauri folder dialog, then the choice is kept as `bugreport:repo` and registered as a project, which is
 * what turns the row into Xử lý. A cancelled dialog does nothing.
 */
export async function pickBugReportRepo(_model: AgentsViewModel): Promise<void> {
    if (picking) {
        return;
    }
    picking = true;
    try {
        let picked: string | null;
        try {
            const fake = import.meta.env.DEV && typeof window !== "undefined" ? window.__bugReportPickFake : undefined;
            if (fake != null) {
                picked = await fake();
            } else {
                // dynamic import keeps non-Tauri contexts (the browser build, vitest) clean, as the New project dialog does
                const { open } = await import("@tauri-apps/plugin-dialog");
                const rtn = await open({ directory: true, multiple: false, title: "Chọn thư mục arcterm" });
                picked = typeof rtn === "string" ? rtn : null;
            }
        } catch (e) {
            pushToast({ title: "Không mở được hộp chọn thư mục", message: errText(e), level: "error" });
            return;
        }
        if (picked == null || picked === "") {
            return;
        }
        try {
            await RpcApi.SetConfigCommand(TabRpcClient, { "bugreport:repo": picked });
        } catch (e) {
            pushToast({ title: "Không lưu được thư mục arcterm", message: errText(e), level: "error" });
            return;
        }
        try {
            await ensureRepoProject(picked);
        } catch (e) {
            // the setting is kept: Process registers the project itself when it finds none
            pushToast({ title: `Không đăng ký được ${picked} làm project`, message: errText(e), level: "error" });
        }
    } finally {
        picking = false;
        await loadAttention().catch(() => {});
    }
}
