# Tích hợp agent: hook, mod và `wsh`

arcterm không thay CLI agent của bạn; nó cài vài mảnh nhỏ vào cấu hình của từng harness để agent **báo về** cockpit (trạng thái, usage, câu hỏi) và **điều khiển** cockpit (bắt đầu run, mở một surface, cập nhật initiative) qua CLI `wsh` đi kèm. Trang này nói arcterm cài gì, ở đâu, và agent dùng `wsh` thế nào.

Các trang liên quan: [Bắt đầu](getting-started.md), [Agent](agent.md), [Usage](usage.md), [Setup](setup.md) (instructions và skills dùng chung), [Orchestrator → CLI](orchestrator.md#cli).

## arcterm cài gì

Mỗi lần mở, app chạy `wsh install-agent-hooks`. Lệnh này làm mới các tích hợp dưới thư mục home của bạn, tất cả trỏ vào một bản `wsh` cố định ở `~/.arc/bin/` (không dựa vào `PATH`):

| Harness | Cài vào đâu | Làm gì |
|---|---|---|
| Claude Code | hook trong `~/.claude/settings.json`; mod `~/.arc/claude-mod` và `~/.arc/claude-view-mod`, liệt kê trong `env.CLAUDE_CODE_PLUGIN_DIRS` | Trạng thái, tên phiên, usage, câu hỏi trên thẻ, chặn lệnh nguy hiểm, hàng đợi lệnh nặng |
| pi | extension của pi (và theme `arc`) | Trạng thái, câu hỏi, usage, hàng đợi lệnh nặng |
| OpenCode | plugin trạng thái | Trạng thái trên rail |
| Antigravity | khóa `arcterm` trong `~/.gemini/config/hooks.json` | Xem [Antigravity](#antigravity-agy) |
| Codex | không có hook | Mở, resume, lịch sử và token đọc từ transcript |

Các tích hợp chỉ hoạt động bên trong terminal của arcterm: chúng cần biến môi trường mà arcterm đặt cho terminal của nó, nên chạy `claude` hay `pi` ở terminal khác thì không có gì thay đổi. Khóa lạ trong file cấu hình được giữ nguyên; file hỏng được báo lỗi và để yên.

Muốn một phiên dev không động vào các file này, đặt `ARC_DEV_NO_GLOBAL_INSTALL=1` trước `task dev`. Agent không hiện trạng thái thì xem `waveapp.log` rồi chạy lại `wsh install-agent-hooks` trong một terminal của arcterm.

## Trạng thái, tên và usage

- **Trạng thái** (`working`, `idle`, `asking`, chờ quyền) đến từ hook vòng đời của harness, qua `wsh agent-hook` (Claude), `wsh agy-hook` (Antigravity) hoặc extension của pi. Agent đang làm mà terminal im quá 3 phút thì hàng của nó đọc `hung · no output Nm` (chỉ claude).
- **Tên phiên** trên sidebar là tiêu đề Claude Code tự đặt (`ai-title`), đi cùng sự kiện trạng thái. Đổi tên tay luôn thắng và không bị ghi đè.
- **Usage** (thanh context, chi phí phiên, quota 5 giờ và tuần): với Claude Code 2.1.287 trở lên, mod Claude báo qua `wsh agentstatus --usage` mỗi khi context, quota hay chi phí đổi; `statusLine` của bạn để nguyên. Bản cũ hơn thì arcterm bọc `statusLine.command` trong `wsh statusline`, chạy lệnh gốc của bạn với cùng stdin. Quota của tài khoản Claude khi không có phiên nào chạy do backend tự hỏi Anthropic (tối đa 5 phút một lần), xem [Usage](usage.md).

## Mod Claude

`claude/arc-mod` trong repo là một plugin Claude Code mà mọi phiên `claude` trong arcterm đều nạp. Nó:

- **Đưa câu hỏi lên cockpit.** `AskUserQuestion` dạng lựa chọn hiện thành thẻ trên Cockpit (và Jarvis, popup của con vật) bên cạnh hộp thoại của chính Claude; trả lời ở đâu cũng được. Câu hỏi dạng gõ chữ hay số để nguyên cho hộp thoại của Claude.
- **Báo trạng thái và usage**, kể cả lượt kết thúc không có câu trả lời (ngắt, lỗi API) mà Claude không chạy hook `Stop`.
- **Nhận lệnh từ cockpit**: prompt gửi từ cockpit (ví dụ composer của Jarvis, hay `wsh agents send`) vào phiên, nối vào lượt đang chạy khi được yêu cầu, hoặc yêu cầu compact.
- **Chặn một số lệnh shell**, bất kể prompt nói gì. Ví dụ dừng app bằng tên tiến trình (`taskkill /IM wave-tauri.exe`): bản dev và arcterm đã cài dùng chung tên, nên lệnh đó giết luôn arcterm đang chạy phiên này cùng mọi agent khác. Dừng theo PID thì được.
- **Hàng đợi lệnh nặng**: trước mỗi lệnh shell nó gọi `wsh jobslot`. Lệnh nặng (build, typecheck, cả bộ test, `npm install`) chờ đến lượt trong hàng đợi chung của wavesrv và giữ chỗ trong lúc chạy; bạn bấm **Skip** ở popover Jobs thì agent nhận "Not run: …" và nên tiếp tục mà báo là đã bỏ qua. Xem [Usage → Hàng đợi lệnh nặng](usage.md#hàng-đợi-lệnh-nặng). pi và Antigravity đi qua cùng hàng đợi.

`claude/arc-view-mod` là mod thứ hai, chỉ để vẽ các hàng transcript của prompt mà mod arc gửi vào. Kiểm tra mod bằng `claude plugin validate claude/arc-mod`.

## Antigravity (agy)

Antigravity (`agy`) là một harness như Claude Code và pi: trạng thái trên rail, câu hỏi trên thẻ cockpit, mở và resume, Conversation History, token, và làm worker của task trong plan.

- **Cài gì**: khi có `~/.gemini/antigravity-cli/`, khóa `arcterm` trong `~/.gemini/config/hooks.json` đăng ký `PreInvocation`, `PreToolUse`, `PostToolUse` và `Stop`, mỗi cái gọi `wsh agy-hook <Event>`. Steering vào `~/.gemini/config/AGENTS.md`, skills vào `~/.gemini/config/skills/` (app desktop Antigravity đọc cùng thư mục, có chủ ý).
- **Lần đầu**: chạy `agy` một lần trong terminal trước. Phần onboarding và điều khoản có một đồng ý chia sẻ dữ liệu mà chỉ bạn quyết; arcterm không tự làm. Agent chưa qua bước này không báo trạng thái, và worker của run ở trạng thái đó bị coi là stall sau 5 phút chưa có token đầu tiên.
- **Câu hỏi**: `ask_question` của agy được trả lời trên thẻ cockpit; ngoài arcterm hook trả lời trung tính và agy hỏi trong UI của nó.
- **Rail không thấy được**: hộp xin quyền của agy (không có hook, nên không có trạng thái "chờ quyền"; worker của run chạy với `--dangerously-skip-permissions`), kích thước context (không có thanh context), và chi phí (token đếm được, chi phí hiện $0).
- **Run**: agy chỉ làm task của plan, không bao giờ làm lead hay reviewer.

## `wsh` cho agent

Agent chạy trong terminal của arcterm có `wsh` và dùng nó để nói chuyện với cockpit. Các nhóm lệnh chính:

| Lệnh | Dùng để |
|---|---|
| `wsh ask` | Hỏi người dùng một câu (có lựa chọn) và đợi câu trả lời trên cockpit |
| `wsh notify [tiêu đề]` | Gửi một thông báo (toast **Message**) |
| `wsh runs …` | `start`, `list`, `show`, `answer`, `cancel`, `land`, `ack`, `attention` |
| `wsh agents …` | `list` các tab agent, `send` tin cho một tab, `read` câu trả lời |
| `wsh ui …` | `reveal <address>` mở một run, terminal agent, record hay surface; `state` đọc người dùng đang nhìn gì; `actions` / `do` chạy một hành động của cockpit |
| `wsh effort …` | Tạo và cập nhật initiative và chunk |
| `wsh jarvis dag …`, `wsh jarvis complete` | Trong terminal của lead hoặc worker: điều khiển DAG của run, kết thúc run hay task |

Lệnh run và DAG đầy đủ: [Orchestrator → CLI](orchestrator.md#cli). `wsh <lệnh> --help` in cú pháp của từng lệnh.

### Điều khiển run và agent khác

Từ bất kỳ terminal nào trong project:

```sh
wsh runs start "Thêm phân trang cho /orders"            # run Quick hoặc theo profile
wsh runs start --plan /abs/path/plan.md                  # run orchestrator từ một plan file
wsh runs route                                           # route lead / workers / reviewers mà run mới sẽ dùng, và nguồn của chúng
wsh runs route --worker-runtime claude --worker-model sonnet   # lưu mặc định workers cho project này (--global: mọi project)
wsh runs show <run-id>                                   # trạng thái, commit, usage, task, kết quả
wsh runs attention                                       # việc đang chờ người dùng
wsh agents list                                          # các tab agent đang chạy
wsh agents send <tab> "…"                                # nhắn cho một agent
wsh agents read <tab>                                    # đọc câu trả lời của nó
```

Một run mà phiên agent bắt đầu bằng `wsh runs start` ghi lại phiên đó: header của run trên surface Agent có link `↰ <phiên>` và run sheet có dòng **started from**, cả khi chạy lẫn khi đã xong; header của phiên có link `↳` ngược về các run nó đã bắt đầu. `wsh runs start` không hỏi lại route: nó lấy route từ profile ([Jarvis → Profile](jarvis.md#profile-mặc-định-của-run-và-nguyên-tắc)) trừ khi bạn truyền cờ, nên xem `wsh runs route` trước khi chạy run tốn kém.

## Skills đi kèm

arcterm mang theo vài skill dạy agent dùng `wsh` và quy ước của cockpit. Mỗi lần launch agent, chúng được chép vào thư mục skills dùng chung rồi chiếu vào thư mục skills của từng harness ([Setup](setup.md)); sửa bản trong `skills/` của repo, không sửa bản đã chép.

| Skill | Dạy agent |
|---|---|
| `cockpit-runs` | Bắt đầu, theo dõi, hủy run; xem việc đang chờ người dùng; nhắn cho một agent khác |
| `cockpit-ui` | Cho người dùng xem một run, terminal, record hay surface; đọc họ đang nhìn gì |
| `effort-tracking` | Theo dõi việc lớn bằng initiative và chunk (`wsh effort`) |
| `doc-review` | Xin người dùng review một bản sửa tài liệu (`.tex`, `.md`) rồi dừng |
| `design-local` | Làm mockup `.dc.html` nhiều artboard trong thư mục nháp bị gitignore |

## Xem thêm

- [Orchestrator](orchestrator.md) — lead, worker và `wsh jarvis dag`.
- [Usage](usage.md) — quota, token, hàng đợi lệnh nặng.
- `docs/agents/` — ghi chú kỹ thuật (tiếng Anh) về usage reporting, tên phiên tự động và Antigravity.
