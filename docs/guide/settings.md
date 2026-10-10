# Settings

**Settings** gom mọi tùy chọn của arcterm vào sáu trang: **General**, **Appearance**, **Terminal**, **Agents**, **Background AI** và **About**. Trang này chỉ cách làm những việc thường gặp (đổi tài khoản Claude, chọn model cho run, bật cờ khởi chạy, đổi theme, cấu hình AI nền) rồi liệt kê từng trang.

Mở bằng nút **Settings** ở đáy nav rail, hoặc `Ctrl+G` rồi `,`. Settings không có phím số `Ctrl+1`…`Ctrl+7` và không lọc theo project.

## Cách Settings hoạt động

- **Ghi ngay.** Không có nút Save: công tắc, lựa chọn và bộ chỉnh số ghi khi bạn đổi; ô văn bản ghi khi bạn rời ô hoặc nhấn `Enter`.
- **Mỗi mục là một thẻ** gồm tiêu đề, một dòng mô tả, và điều khiển. Rê chuột vào một mục để thấy **khóa cấu hình** của nó (ví dụ `notify:os`); bấm vào để chép. Tooltip nói giá trị nằm ở đâu: `synced in settings.json` hoặc `stored on this machine only`.
- **Dấu thay đổi.** Mục khác giá trị mặc định có chấm accent và nút **Revert to default**. Cạnh tên mỗi trang ở cột trái có số mục đã đổi, và đầu trang có nút **Reset section** đưa cả trang về mặc định.
- **Tìm kiếm.** Ô **Search settings** ở đầu cột trái lọc theo tiêu đề, mô tả và khóa cấu hình, trên mọi trang; chỉ những trang còn kết quả mới hiện.
- Cấu hình dạng `synced` nằm trong `settings.json` ở thư mục `config` (xem [Bắt đầu](getting-started.md#dữ-liệu-cấu-hình-và-log)); `Revert` xóa khóa đó để mặc định của app có hiệu lực lại.

<!-- shot: settings-agents.png | Trang Agents: thẻ Claude account (hàng Default với tag /login và hai thanh 5h/Week, một hàng tài khoản token với menu ⋯), thẻ Runs với Run route, thẻ Launch flags với tab runtime | Mở Settings (`Ctrl+G` `,`), bấm `[data-section="agents"]`. Tài khoản token cần thêm thật qua **+ Add account**; thẻ Launch flags là `[data-flag-tabs]`. Scenario CDP `settings-pages` đi qua cả sáu trang -->

## Làm thế nào

### Đổi tài khoản Claude, hoặc thêm một tài khoản

Trang **Agents**, thẻ **Claude account**. Mỗi tài khoản là một dòng: tên, nhãn (`/login` cho tài khoản Default bạn đăng nhập bằng `claude`, `token` cho tài khoản thêm bằng token), email nếu có, và mức dùng 5 giờ / tuần dưới dạng thanh (chuyển sang màu cảnh báo từ 80%) kèm `12m ago`. Tài khoản chưa dùng ghi "Not used yet".

1. **Đổi tài khoản**: bấm dòng của tài khoản đó. Dòng được chọn có dấu ✓ và ghi "new agents use this": từ đây agent mới và các meter quota theo tài khoản này.
2. Nếu đang có agent Claude chạy trên tài khoản khác, hộp thoại **Resume agents on <tên>?** hiện ra. Agent đang rảnh (idle) được chọn sẵn; agent đang làm ghi "working — resume after this turn", agent đang hỏi ghi "asking — resuming drops the question". Bấm **Resume selected** để mở lại chúng trên tài khoản mới trong cùng session; không chọn thì chúng giữ tài khoản cũ đến khi kết thúc.
3. **Thêm tài khoản**: bấm **+ Add account**. Hộp thoại mở một terminal nhỏ chạy `claude setup-token`; đăng nhập trên trình duyệt bằng tài khoản cần thêm, arcterm tự nhận token từ terminal. Đã có token sẵn thì bấm **Have a token already? Paste it**, dán token (bắt đầu bằng `sk-ant-oat`) rồi **Save**. arcterm hỏi Claude xem token có được chấp nhận không và từ chối token bị từ chối.
4. Bước cuối đặt **Name** và, nếu arcterm đã biết các email, **Same account as** (xem dưới). Bấm **Done**. Token mới chưa được chọn: bạn bấm vào dòng của nó khi muốn dùng.
5. Menu **⋯** của một tài khoản token: **Rename**; **Same account as…** (chọn một email arcterm đã thấy, **Other email…**, hoặc **None**: nối tài khoản token với tài khoản `/login` cùng email để chúng dùng chung số quota và không bị đếm là hai); **Remove** (xóa token khỏi máy sau khi hỏi; nếu đang chọn thì agent mới quay về tài khoản `/login`).

Quota Claude là của tài khoản đang chọn. Tài khoản thêm bằng token không đọc được quota khi không có session chạy; số của nó có sau khi một session của nó báo về.

### Chọn model cho run mới

Trang **Agents**, thẻ **Runs**, mục **Run route** ("Harness and resolved model for new runs"). Bấm bộ chọn, chọn harness (chỉ những harness làm được lead của run: Claude Code và pi) và model. Chọn lại đúng harness đang dùng giữ nguyên model; đổi harness thì bỏ model vì model thuộc về harness. Đây là route mặc định: một project có thể có route riêng, và hộp thoại **New** cho chọn lại từng lần.

Muốn xem lead và worker của một run mới sẽ dùng model nào, hoặc đặt mặc định cho worker, dùng `wsh runs route` (xem [Tích hợp agent](agent-integration.md#điều-khiển-run-và-agent-khác)).

### Bật cờ khởi chạy cho agent

Trang **Agents**, thẻ **Launch flags**. Hàng tab trên cùng chọn runtime cần sửa (Claude, Codex, OpenCode, Pi, Antigravity); bật các cờ muốn thêm vào lệnh khi khởi chạy agent đó (ví dụ Claude có `--dangerously-skip-permissions`, `--verbose`, `--continue`). Pi không có cờ nào.

Mặc định các cờ được xóa sau mỗi lần khởi chạy. Bật **Remember flags** để dùng lại các cờ đã chọn cho mọi agent mới. Cờ bạn bật hiện thành thẻ ở ô **Command** của hộp thoại **New** và có thể bỏ riêng từng cờ ở đó.

### Đổi theme, font và màu

Trang **Appearance**: bấm một preset trong thẻ **Theme**; các màu khác được tính lại từ preset đó. Thẻ **Colors** chỉnh bốn màu vai trò (**Accent**, **Working / accept**, **Asking / attention**, **Blocked / reject**) bằng bảng màu hoặc ô chọn hex, nhưng chỉ khi bạn muốn lệch khỏi preset. Revert từng màu để quay về màu của preset.

### Đổi nơi đặt vault hoặc bật đồng bộ vault

Trang **General**, thẻ **Vault & sync**.

1. **Vault path**: nhập đường dẫn hoặc bấm biểu tượng thư mục để chọn. Thư mục phải tồn tại; để trống thì dùng vault mặc định (`~/.waveterm/vault`). Đường dẫn không hợp lệ bị từ chối với thông báo lỗi.
2. **Sync remote**: nhập một git remote riêng tư (`git@host:you/vault.git`) để vault, initiative và các cài đặt di động giống nhau trên mọi máy. Để trống thì tắt đồng bộ. Dòng trạng thái ở chân thẻ cho biết `Sync off — git not found`, `Sync off — no remote`, `Syncing…`, `Last synced 3m ago`, `Sync failed: …`, kèm số bản xung đột (`conflict copies`) và effort lỗi.

Cũng làm được bằng lệnh: `wsh vault remote [url]`, `wsh vault sync`, `wsh vault status`.

### Cho AI nền chạy

Một số tính năng của arcterm tự gọi model nền (phân loại session, tóm tắt liên tục, "volunteer judge", đặt tên session pi). Chúng cần một runtime ở trang **Background AI**:

1. Thẻ **Runtime**: chọn **OpenRouter** (mặc định khi để trống) hoặc một harness đã cài (mỗi dòng ghi `installed` / `not installed`).
2. Chọn OpenRouter thì ở thẻ **OpenRouter** dán **OpenRouter API key** vào ô bí mật rồi Enter. Khóa nằm trong kho bí mật của hệ điều hành, không bao giờ hiện lại; ô ghi "Key stored" và có nút **Clear**. Chưa có khóa thì thẻ cảnh báo "background AI features stay off until a key is stored".
3. **Cheap model**: model OpenRouter dùng cho các việc trên (chỉ có tác dụng với OpenRouter).

### Cập nhật Claude Code và các harness khác

Trang **About**, thẻ **Coding agents** liệt kê mỗi harness đã cài với phiên bản. Khi có bản mới hơn, dòng đó có nhãn "N available" và nút **Update** chạy lệnh cập nhật của chính harness. Các session đang mở giữ bản cũ đến khi khởi động lại. Công tắc **Check for harness updates** (mặc định bật) cho arcterm hỏi npm mỗi 6 giờ và nhắc một lần khi có bản mới.

## Các trang

### General

| Thẻ | Mục | Ghi chú |
|---|---|---|
| **Startup** | **Startup surface** | Surface mở khi khởi động. **Last opened** (mặc định) mở lại surface bạn rời; hoặc Cockpit, Jarvis, Usage, Code, Diff, Radar. |
| | **Show details rail by default** | Rail chi tiết của từng agent trên Agent (file đổi, artifact, upload, terminal). |
| **Notifications** | **OS notifications** (`notify:os`) | Thông báo hệ thống khi arcterm ở nền; bấm vào mở agent. |
| | **In-app toasts** (`notify:toast`) | Toast khi arcterm ở trước, trừ khi bạn đang nhìn đúng agent đó. |
| | **When an agent finishes** (`notify:reply`) | Báo cả khi agent xong một lượt, không chỉ khi nó cần bạn. Worker của run không bao giờ báo. |
| **Vault & sync** | **Vault path**, **Sync remote** | Xem trên. |

Cả ba công tắc thông báo mặc định bật.

### Appearance

| Thẻ | Mục | Ghi chú |
|---|---|---|
| **Theme** | Preset | Graphite (mặc định), Midnight, Slate, Carbon, Nocturne, One Dark, Monokai. |
| **Colors** | **Accent**, **Working / accept**, **Asking / attention**, **Blocked / reject** | Ghi đè màu vai trò; Accent có bảng màu sẵn và ô hex tùy ý. |
| **Fonts** | **Interface font** | Inter (mặc định), Hanken Grotesk, System UI. |
| | **Code font** | JetBrains Mono (mặc định), Hack, Fira Code. |
| **Jarvis** | Trang phục | **Flag shirt**, **Holds the flag** hoặc **Off**. Vào 30/4, 1/5 và 2/9 Jarvis mặc áo cờ kể cả khi tắt. |
| **Jarvis** | **Jarvis quotes** | Bật (mặc định): thỉnh thoảng, khi không có gì chờ bạn, Jarvis nói một câu danh ngôn về lập trình. |

### Terminal

Áp dụng cho mọi terminal của agent và shell.

| Thẻ | Mục | Mặc định |
|---|---|---|
| **Text** | **Terminal font** (JetBrains Mono, Hack, Fira Code) | JetBrains Mono |
| | **Font size** (px) | 14 |
| **Cursor** | **Cursor style**: Block, Bar, Underline | Bar |
| | **Cursor blink** | Bật |
| **Behavior** | **Scrollback** (số dòng lịch sử mỗi terminal, bước 250) | 1000 nếu chưa đặt |
| | **Copy on select** | Bật |

### Agents

Gồm ba thẻ: **Claude account**, **Runs** (**Run route**) và **Launch flags**. Cách dùng ở phần "Làm thế nào" bên trên.

### Background AI

| Thẻ | Mục | Ghi chú |
|---|---|---|
| **Runtime** | Chọn runtime | OpenRouter hoặc harness đã cài. Để trống là OpenRouter. |
| **OpenRouter** | **OpenRouter API key**, **Cheap model** | Khóa lưu trong kho bí mật của hệ điều hành. Ô **Cheap model** gợi ý ví dụ `deepseek/deepseek-v4-flash`; bị khóa khi runtime không phải OpenRouter. |
| **Radar** | **Radar audit** | Route của các session audit của [Radar](radar.md). Mỗi lần quét chạy một session chỉ-đọc cho mỗi commit sửa lỗi trên route này. Chỉ Claude và pi (cần có công cụ để đọc repo); OpenRouter không dùng được. Trống là Claude với Sonnet. |

### About

| Thẻ | Mục | Ghi chú |
|---|---|---|
| **Versions** | **App version**, **Backend version**, **Backend build time**, **Platform** | Nếu backend khác phiên bản app, đầu thẻ cảnh báo `dist/bin` cũ: chạy `task build:backend` rồi khởi động lại. |
| **Coding agents** | Danh sách harness, **Check for harness updates** | Xem "Cập nhật Claude Code và các harness khác". |

## Những thứ nằm ngoài Settings

- **Phím tắt** cố định, không đổi được: [Phím tắt](../keyboard-shortcuts.md).
- **Instructions và skills** dùng chung cho các harness: [Setup](setup.md).
- **Giới hạn và tiêu thụ quota**: [Usage](usage.md).
- **Cách chạy lệnh nặng** (`jobs:mode`, `jobs:slots`): lệnh nặng (build, typecheck, cả bộ test) của mọi agent và run xếp chung một hàng đợi. `jobs:mode` = `auto` (mặc định) cho chạy bao nhiêu cũng được miễn RAM còn đủ; `slots` giới hạn thêm ở `jobs:slots` lệnh cùng lúc (1–4, mặc định 1); `off` tắt hàng đợi, mọi lệnh chạy ngay. `jobs:pauseuntil` (Unix ms) tắt hàng đợi đến giờ đó, do nút **Pause 1h / 4h** ghi. Trên macOS, "RAM đủ" đọc theo memory pressure của hệ điều hành. Không có thẻ trong Settings: ghi bằng bộ chọn **Slots** ở popover của chip **Jobs** trên app bar, xem [Usage → Hàng đợi lệnh nặng](usage.md#hàng-đợi-lệnh-nặng).
