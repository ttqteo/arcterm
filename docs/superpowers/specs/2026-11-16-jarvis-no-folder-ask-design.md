# Ask Jarvis ở No folder

Ngày: 2026-11-16. Nguồn: brainstorm `.superpowers/brainstorm/jarvis-no-folder-ask/`.

## Ý định

Ô Ask Jarvis của pet (popover cạnh con pet) có thêm một đích là **No folder**. Hỏi ở đó thì không cần chọn project:
Jarvis tự quyết lời thuộc project nào, rồi tự tạo agent hoặc chuyển lời vào agent của project nó chọn.

## Hôm nay có gì

- Ô Ask (`frontend/app/view/jarvis/peterrand.tsx`) gửi qua `sendErrand` (`petactrun.ts:173`): đăng một tin `consult`
  vào channel đã chọn, rồi stream `ConsultCommand`. Lệnh này chạy harness một lần với cwd là `ch.ProjectPath` của
  channel (`pkg/wshrpc/wshserver/wshserver_jarvis.go:108`), tối đa 120 giây. Khi không có channel thì không hỏi được
  (placeholder "No project to send to yet").
- Đích hiện tại là `petPeekDestAtom` (`petstore.ts:312`), set từ `petpeek.tsx:1496`.
- No folder đã có sẵn: `~/.arc/no-folder`, được Claude Code tin cậy sẵn (`pkg/jarvis/nofolder.go`, `EnsureNoFolder`).
- `launchAgent(model, opts)` (`frontend/app/cockpit/cockpit-actions.ts:92`) mở một agent mới với `projectPath` và
  `task`. Work on của initiative dùng nó (`initiativeworkaction.ts:77`). Gửi vào agent đang mở dùng cùng đường với
  `wsh agents send`.
- Consult claude chạy `claude -p --output-format stream-json` (`pkg/consult/consult.go:90`), không có
  `--allowedTools`, nên không chạy được lệnh nào. Thiết kế này không cần nó chạy lệnh.
- `wstore.EnsureChannelAtPath(ctx, name, projectPath)` (`pkg/wstore/wstore_channel.go:96`) tạo hoặc lấy channel theo
  đường dẫn.

## Các quyết định

### 1. Jarvis làm gì sau khi chọn project

Câu hỏi thì Jarvis trả lời ngay trong popover, như hôm nay. Việc cần làm thì vào agent đang mở của project đó, không
có thì mở agent mới.

**Agent's call (builder question 1):** việc được giao như chính lời bạn gõ, không như tin từ agent khác.
`AgentsSendCommand` (`wshserver_agentmsg.go:327`) cần tab gửi và bọc lời trong `agentmsg.Envelope` ("Not typed by the
user"), nên không dùng. `AgentPromptCommand` (:406) giao prompt của cockpit không envelope nhưng từ chối agent đang
ngủ; `deliverToAgent` (:372) đánh thức agent ngủ. Cần một đường giao mới: prompt không envelope, đánh thức agent ngủ.
Agent đang chờ bạn trả lời một câu hỏi hay một quyền thì không nhận việc, và không tính là agent đang mở.

### 2. Khi nào làm luôn, khi nào hỏi

Rõ project và có không hoặc một agent đang mở thì Jarvis làm luôn. "Agent đang mở" là agent bạn tự mở ở thư mục
project hoặc một worktree của nó, kể cả agent đang ngủ. Agent của một orchestrator run (`runId`: lead, worker) và ghế
council không tính, nên Jarvis không bao giờ giao việc vào session của engine (builder question 2, bạn trả lời). Không khớp rõ project nào, hoặc project có nhiều
agent đang mở, thì hiện thẻ cho bạn chọn (mục 7).

### 2b. Khi Jarvis chọn sai project: làm luôn, sửa sau

Thẻ chọn chỉ bắt được lúc Jarvis biết mình chưa chắc. Nó vẫn có thể tự tin mà sai, nên không có chuyện hoãn: Jarvis
làm luôn, rồi Agent surface hiện một dải "Jarvis chọn <project> vì … · Sai project?" trên agent vừa nhận việc. Lý do
lấy từ phán quyết, nên phán quyết cần thêm một trường `reason` ngắn. Bấm "Sai project?" thì chọn project đúng (cùng
danh sách như thẻ mơ hồ):

- agent mới: đóng agent đó và mở lại ở project bạn chọn, với cùng lời giao;
- agent đã mở từ trước: lời đã được đọc, không rút lại được, nên chỉ gửi lời sang project đúng (agent đang mở ở đó, hoặc
  agent mới).

**Agent's call:** trường `reason`, và dải ở lại đến khi bạn đóng nó hoặc gõ vào agent đó.

Một consult chạy trong No folder nhận danh sách project và agent đang mở. Nó trả lời câu hỏi ngay, hoặc trả một
phán quyết JSON (project, agent, mơ hồ hay không) để frontend gọi `launchAgent`, gửi vào agent, hoặc hiện thẻ chọn.
Model chỉ phán quyết, còn luật làm luôn hay hiện thẻ nằm ở frontend, trong một model `.ts` thuần có test, không phụ
thuộc vào việc model có nghe lời hay không.

Các hướng đã cân nhắc rồi bỏ: Jarvis tự chạy `wsh` (cần cấp quyền chạy lệnh cho một consult `-p` và một lệnh `wsh`
mới để mở agent), một agent Jarvis thường trực (tốn RAM và token của một agent luôn mở), khớp theo luật không dùng
model (không hiểu lời không nêu tên project), chọn project bằng vault (không có điểm số theo project), giao việc thành
quick run (trái với quyết định 1).

### 4. Màn hình sau khi chuyển

Popover đóng, app chuyển sang Agent surface và chọn agent vừa nhận việc, như nút Open hôm nay (escort,
`petactrun.ts:39`, qua router `openref.ts`).

### 5. No folder trong ô chọn đích

Ô chọn đích mở sẵn ở No folder, đứng đầu danh sách. Các project vẫn ở dưới để hỏi thẳng.

**Agent's call (builder question 4):** ô mở ở No folder mỗi lần app khởi động. Trong một phiên app, ô nhớ lần chọn
cuối như `petPeekDestAtom` hôm nay (chỉ trong phiên, vì một oid channel lưu lại có thể sống lâu hơn channel đã xoá).
Vì No folder luôn có, Ask hỏi được cả khi chưa có channel project nào. Hỏi thẳng một project thì vẫn là consult như
hôm nay, không định tuyến.

### 6. Jarvis được biết gì để chọn

Prompt của consult định tuyến kèm:

- mỗi project đã đăng ký: tên và đường dẫn;
- mỗi agent đang mở: tên, project, đang làm hay rảnh, lời giao gần nhất.

Model trả lời câu hỏi bằng văn xuôi như hôm nay. Với một việc, nó kết thúc bằng một khối JSON
`{project, agent, ambiguous, task}`, và frontend tách khối này khỏi phần stream: khối JSON không hiện ra như văn bản
trả lời.

### 7. Thẻ chọn khi mơ hồ

Popover hiện một thẻ: Jarvis nói một câu vì sao chưa chắc, rồi liệt kê các project hoặc agent nó cân nhắc, mỗi cái một
dòng bấm được, cộng dòng "Mở agent mới ở <project>". Bấm một dòng thì làm như trường hợp rõ, tức là đưa bạn tới agent
đó (quyết định 4). JSON sai định dạng hoặc thiếu cũng rơi về thẻ này, với mọi project.

**Agent's call (builder question 3):** không project nào hợp cũng là trường hợp mơ hồ, và thẻ có thêm dòng "Mở agent mới
ở No folder" (`~/.arc/no-folder`). Trường `project` của phán quyết chỉ được nêu một project đã đăng ký, hoặc
`no-folder`, hoặc để trống; không bao giờ là một đường dẫn tuỳ ý.

### 8. Agent mới chạy harness nào

Agent mới được mở bằng `launchAgent`, với harness và model launcher đã nhớ lần cuối (`agentRuntime` trong
`launcher.ts`), trong thư mục project, không dùng worktree. Lời giao là lời bạn gõ; Jarvis có thể viết lại cho rõ.
Ô harness dưới Ask chỉ chọn ai chạy consult định tuyến.

### 9. Lời hỏi được lưu ở đâu

Một channel No folder được tạo sẵn với `ProjectPath` là `~/.arc/no-folder` (`EnsureNoFolder` +
`EnsureChannelAtPath`). Nhờ vậy `ConsultCommand` chạy gần như nguyên vẹn, vì cwd và lịch sử channel đã có, và lời hỏi
cùng câu trả lời được lưu như các channel khác. Chỉ có phần prompt định tuyến là mới. Việc đã chuyển nằm trong
transcript của agent nhận nó.

## Để lại cho người xây

- Định dạng chính xác của khối phán quyết, và cách tách nó khỏi phần stream.
- Luật "làm luôn hay hiện thẻ" viết thành một model `.ts` thuần, có test bên cạnh.
- Chọn agent khi project có đúng một agent đang mở, kể cả khi agent đó đang làm (lời sẽ được xếp hàng).
- Một kịch bản CDP (`scripts/cdp/scenarios.mjs`) cho ô chọn No folder, thẻ mơ hồ và cú chuyển sang Agent surface.
- Một dòng `CHANGELOG.md` dưới `Added`.

## Quyết định khi xây (2026-11-16, lead tự quyết, run không người)

Các mục "Để lại cho người xây" và những chỗ spec còn mở, mỗi cái kèm lý do.

1. **Khối phán quyết.** Ở cuối câu trả lời, một code fence có info string `arc-route`, chứa đúng một object JSON:
   `{"project": "<tên project đã đăng ký> | no-folder | \"\"", "agent": "<tab id hoặc \"\">", "ambiguous": bool,
   "task": "<lời giao>", "reason": "<một câu ngắn>", "considered": ["<tên project>", …]}`. `considered` là tuỳ chọn,
   để thẻ mơ hồ liệt kê những project model đã cân nhắc; tên không đăng ký bị bỏ. Lý do: fence có tên thì model viết
   đúng ổn định hơn một marker tự chế, và Markdown của Channels vẫn đọc được nếu khối lọt vào lịch sử.
2. **Tách khối khỏi stream.** Mọi thứ từ dòng mở `` ```arc-route `` trở đi bị ẩn khỏi phần hiện ra, cả lúc đang stream
   (khối dở dang cũng ẩn). Không có khối nào = một câu hỏi đã được trả lời, không làm gì thêm. Có dòng mở mà JSON không
   đọc được hoặc thiếu `task` = sai định dạng, rơi về thẻ chọn với mọi project. Lý do: không phân biệt được "câu hỏi"
   với "việc mà model quên khối", nên chỉ một khối đã bắt đầu mới được coi là việc.
3. **Prompt định tuyến dựng ở frontend**, trong model thuần `frontend/app/view/jarvis/jarvisroute.ts`, rồi đưa vào
   `ConsultCommand` như `prompt`; tin `consult` lưu vào channel chỉ là lời bạn gõ. Lý do: frontend đã giữ danh sách
   project, roster agent và danh sách council (để loại ghế council); không cần lệnh Go mới cho prompt, và cả luật lẫn
   prompt được test thuần. `ConsultCommand` không đổi. Câu trả lời lưu vào channel giữ nguyên khối `arc-route`: chấp
   nhận, vì nó là bản ghi của lần định tuyến.
4. **"Agent đang mở" (đủ điều kiện nhận việc):** một `AgentVM` loại agent (không phải terminal, không phải background),
   không có `runId`, tab không phải ghế (`agent`) của council nào, không đang `asking`, và `project` trùng tên một
   project đã đăng ký (launch ghi tên project vào tab, kể cả launch vào worktree). Agent ở No folder tính cho project
   `no-folder`: launcher ghi tab No folder dưới tên project `HOME_NAME` ("Home", `launcher.ts`), nên `project ===
   HOME_NAME` là No folder. Agent đang ngủ vẫn tính. Ghế council lấy từ `councilListAtom("")` sau khi
   `await loadCouncils("")` (atom là null tới khi nạp; đọc thẳng thì mọi ghế lọt qua).
5. **Luật (`decideRoute`, thuần, có test):** không khối → `answer`; sai định dạng → `choose` mọi project + No folder;
   `ambiguous` hoặc `project` trống → `choose` các project trong `considered` (rỗng thì mọi project) + dòng "Open a new
   agent in No folder"; `project` không đăng ký và không phải `no-folder` → `choose` mọi project; project rõ: 0 agent
   đang mở → `launch`, 1 → `send` (kể cả khi agent đang làm: lời được xếp hàng), nhiều → `choose` các agent đó + "Open
   a new agent in <project>", agent mà phán quyết nêu đứng đầu. Bấm một dòng project trên thẻ chạy cùng luật với project
   đó như phán quyết rõ.
6. **Đường giao mới: `AgentsAssignCommand {tab, text}`** (trả `CommandAgentsSendRtnData`). Tra roster như
   `AgentsSendCommand`, từ chối agent có `RunId` (session của engine) và agent đang `asking`, rồi `deliverToAgent` với
   chính lời giao, không envelope, không ghi khoá send-back (người gửi là bạn, không phải agent). Ngủ thì được đánh
   thức. Lý do: đúng quyết định 1, và tái dùng `deliverToAgent` thay vì sửa `AgentPromptCommand` mà nơi khác đang dựa
   vào.
7. **Channel No folder:** `EnsureNoFolderCommand` tạo thêm channel tên "No folder" ở đường dẫn đó
   (`EnsureChannelAtPath`) và trả `channelid` cạnh `path`. Một lệnh cho cả launcher lẫn Ask; launcher bỏ qua trường mới.
8. **Đích của ô Ask:** `petPeekDestAtom` vẫn là `string | null`; `null` và sentinel `NO_FOLDER_DEST` đều là No folder.
   Một oid channel đã chọn mà không còn thì rơi về No folder, không về channel mới nhất: bậc "channel đang chọn ở Jarvis
   surface" và "channel mới nhất" của `resolveDestination` bỏ đi, vì No folder luôn hỏi được. Option "No folder" đứng
   đầu ô chọn, rồi các project như hôm nay. Ô chọn hiện cả khi chưa có project nào.
9. **Chuyển màn hình:** `launch` dùng `launchAgent` (tự chuyển sang Agent surface và focus agent mới); `send` gọi
   `AgentsAssignCommand` rồi `openTarget(model, {kind: "agent", tabId})`. Xong thì `closePeek()`. Lỗi rơi vào ô trả lời
   của errand (trạng thái error), popover ở lại.
10. **Harness của agent mới:** harness launcher nhớ (`launcherRuntimeAtom`) khi nó là một hàng agent đang được
    offer và không phải `terminal`; không thì `resolveDefaultRuntime(pref, harnesses)` (`harnessstore.ts`); không bao
    giờ là `terminal` (một shell trơn làm mất lời giao); không có harness nào thì errand báo lỗi. Ở No folder, harness
    phải qua `homeOffered("agent", runtime, path)` (`launcher.ts`), không thì `claude`, không có `claude` thì lỗi. Lệnh
    khởi động ghép như `initiativeworkaction.ts` (`runtimeStartupCommand` + `naFlagsAtom`), không worktree,
    `projectName` = tên project, và `HOME_NAME` cho No folder (như launcher, để cây không mọc thư mục thứ hai). Nhãn
    hiển thị "No folder" dùng `NO_FOLDER_LABEL` sẵn có của `launcher.ts`.
11. **Dải "Sai project?"** (UI tiếng Anh như phần còn lại của app): "Jarvis chose <project> because <reason> · Wrong
    project?"; thiếu `reason` thì bỏ vế "because". Trạng thái là `jarvisRouteBandAtom` theo tab id, chỉ trong phiên
    app. Dải nằm trên Agent surface ngay dưới `HeldAskBar` của agent đang xem, nên hiện ở cả view Terminal lẫn Chat.
    Dải mất khi bấm ×, khi bạn gõ phím (không phải phím bổ trợ đứng một mình) trong ô của agent đó (terminal hoặc ô
    Chat), hoặc khi đổi project xong. "Wrong project?" mở ngay trong dải cùng danh sách dòng như thẻ mơ hồ (một component
    dùng chung). Agent mới (`fresh`): đóng tab đó (`closeTabLogged`) rồi mở lại ở project chọn với cùng lời giao; agent có
    từ trước: chỉ giao lời sang project chọn theo luật ở mục 5, tính agent đang mở không kể tab vừa đóng. Agent nhận
    việc mới mang dải với lý do "you picked it".
12. **Kiểm tra trên app thật (CDP) không chạy consult hay harness thật.** Một hook chỉ có ở DEV,
    `globalThis.__waveJarvisRoute`, chạy phần sau stream trên một câu trả lời soạn sẵn, và có chế độ `dryRun` bỏ qua
    `AgentsAssignCommand`/`launchAgent` nhưng vẫn chuyển màn hình và đặt dải. Lý do: Final không được tốn token hay mở
    agent thật chỉ để chụp; agent fixture không có session để nhận lời. Đường giao thật được test bằng Go; consult thật
    được ghi một dòng trong `docs/hand-checks.md`.
