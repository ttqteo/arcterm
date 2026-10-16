# Settings

**Settings** gom mọi tùy chọn của arcterm vào bảy trang: **General**, **Appearance**, **Terminal**, **Agents**, **Storage**, **Background AI** và **About**. Trang này chỉ cách làm những việc thường gặp (đổi tài khoản Claude, chọn model cho run, bật cờ khởi chạy, đổi theme, cấu hình AI nền) rồi liệt kê từng trang.

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

### Trả lời câu hỏi của agent từ Telegram

Trang **General**, thẻ **Notifications**, hàng **Telegram**. Khi một agent dừng ở một câu hỏi (ask), arcterm gửi câu hỏi đó tới chat Telegram bạn đã ghép; bạn bấm một lựa chọn hoặc trả lời bằng vài chữ, agent chạy tiếp. Telegram đi qua cùng đường trả lời mà bảng hỏi trong cockpit dùng.

1. Trong Telegram, nhắn `@BotFather`, gửi `/newbot` và làm theo; BotFather trả một token.
2. Dán token vào ô **Bot token from @BotFather** rồi Enter. Token nằm trong kho bí mật của hệ điều hành, không bao giờ hiện lại; hàng chỉ ghi có token hay chưa, và có liên kết **Remove token** để xóa.
3. Bật công tắc. arcterm hỏi Telegram đúng một lần xem token có dùng được không: dòng trạng thái đi từ `Checking the token…` tới `@<bot> · not paired`. Token sai thì dòng đó đổi thành `Token rejected by Telegram`. Nếu mạng lỗi (Telegram không trả lời), dòng hiện lỗi đó và arcterm hỏi lại khi bạn đổi một cài đặt hay bấm Pair, nếu không thì sau 1 phút, rồi giãn dần tới 30 phút.
4. Bấm **Pair**. Hàng hiện một mã 6 số, dùng được khoảng 10 phút. Trong 10 phút đó arcterm kết nối với Telegram dù đang ở chế độ nào, để nhận `/start`.
5. Trong Telegram, gửi `/start <mã>` cho bot. Hàng đổi thành `Paired with <tên chat> · …` và bot trả lời "Paired. Agent questions will arrive here.". Chỉ chat đã ghép được trả lời; tin nhắn của chat khác bị bỏ qua.

#### Khi nào arcterm kết nối

arcterm **không** hỏi Telegram liên tục. Nó chỉ kết nối khi cả hai điều sau cùng đúng: đang trong **khoảng thời gian bạn cho phép**, và **có một câu hỏi đang mở** (chờ quá 8 giây). Hết câu hỏi, hoặc hết khoảng thời gian cho phép, nó ngắt; không có gì để làm thì không gửi một yêu cầu nào tới Telegram. Ngoại lệ là hai việc nó tự làm trong mọi chế độ: một lần kiểm tra token (khi bật công tắc hoặc đổi token) và kết nối trong lúc mã ghép cặp còn hiệu lực.

Khi đã có token và công tắc bật, hàng có thêm mục **Connect** với ba chế độ:

- **Manual** (mặc định): chỉ cho phép khi bạn bật tạm. Ở dòng **On for**, bấm `1h`, `2h` hoặc `4h`, hoặc gõ số giờ riêng (0,25 đến 24) rồi bấm **Start**. Dòng hiện `On until <giờ>` cùng nút **Turn off now**. Hết giờ hoặc bấm **Turn off now** thì dòng trạng thái là `Off — turn it on for a while`.
- **Schedule**: cho phép theo lịch hằng tuần, theo giờ máy. Chọn các ngày (Mon…Sun) và giờ **từ** / **đến**; nút **Office hours** đặt Thứ Hai đến Thứ Sáu, 08:00–17:30. Giờ **đến** không sau giờ **từ** thì khoảng đó chạy qua nửa đêm (`Runs past midnight`). Ngoài lịch, dòng trạng thái là `Off until <giờ>`; **On for** vẫn dùng được để bật thêm ngoài lịch.
- **Always**: lúc nào cũng cho phép; **On for** không còn.

Câu hỏi đã gửi mà khoảng thời gian cho phép kết thúc trước khi bạn trả lời: tin nhắn được sửa thành `— Telegram is off until <giờ>` (hoặc `— Telegram is off; answer in arcterm` nếu không có gì sẽ bật lại), và câu hỏi được gửi lại khi tới giờ cho phép nếu nó vẫn còn mở.

Dòng trạng thái cho biết arcterm đang ở đâu:

| Dòng trạng thái | Nghĩa |
|---|---|
| `Paired with <chat> · Off until Mon 08:00` / `Off — turn it on for a while` | Đã ghép, nhưng ngoài thời gian cho phép: không kết nối. |
| `Paired with <chat> · connects only when an agent asks` | Trong thời gian cho phép, đang chờ một câu hỏi. |
| `Paired with <chat> · Connected · 1 question open` | Đang kết nối, `n` câu hỏi đang chờ trả lời ở Telegram. |

Sau đó, mỗi câu hỏi tới như một tin nhắn có tên agent, nội dung câu hỏi và các lựa chọn là nút:

- **Bấm một nút** để trả lời ngay; tin nhắn đổi thành `✓ <lựa chọn>` và mất nút. Câu hỏi chọn nhiều lựa chọn hiện nút bật/tắt và nút **Send**.
- **Reply** (trả lời có trích dẫn) vào tin nhắn để trả lời bằng chữ của bạn.
- Một ask có nhiều câu hỏi được gửi từng câu một, và các câu trả lời chỉ gửi đi cùng lúc sau câu cuối, như bảng hỏi trong cockpit.
- Câu đã được trả lời ở nơi khác (trong app, bởi Gatekeeper, bởi lead của run, hoặc agent đã đi tiếp) thì tin nhắn đổi thành `✓ Answered in arcterm`.
- Một ask chờ chưa tới 8 giây thì chưa gửi, để câu mà Gatekeeper trả lời trong vài giây không tới điện thoại bạn.

Chỉ **nội dung câu hỏi** được gửi: không có transcript, không có nội dung file, không có đầu vào của công cụ. Telegram **không** làm được gì khác: không gửi prompt, không bắt đầu hay dừng agent hay run, không đọc transcript. Nó chỉ trả lời những câu hỏi đang chờ.

**Unpair** (hiện ở dòng trạng thái khi đã ghép) xóa chat đã ghép; bot ngừng gửi cho tới khi bạn ghép lại. Tắt công tắc cũng ngừng gửi. Trạng thái bật/tắt, chat đã ghép và thời gian cho phép (chế độ, lịch, **On for**) chỉ lưu trên máy này, không đồng bộ qua vault.

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
| | **Telegram** (`telegram:enabled`) | Gửi câu hỏi đang chờ của agent tới Telegram của bạn để trả lời ngay ở đó. Xem [Trả lời câu hỏi của agent từ Telegram](#trả-lời-câu-hỏi-của-agent-từ-telegram). Mặc định tắt. |
| **Window** | **Minimize** (`window:minimize`) | Nút minimize (cả nút vàng và `⌘M` trên macOS) thu cửa sổ vào Sprout (`sprout`, mặc định) hay đưa xuống Dock hoặc taskbar (`dock`). Nút **Sprout** trên app bar luôn thu vào Sprout. |
| **Window** | **Fold to** | Góc màn hình Sprout thu vào: trên trái, trên phải, dưới trái hay dưới phải (mặc định). Kéo Sprout đi chỗ khác thì lần thu sau về đúng chỗ đó (hiện *Where you dragged it*) cho đến khi bạn chọn lại một góc. Lưu theo máy, không đồng bộ. Cũng có ở chuột phải nút **Sprout** trên app bar → **Fold to**. |
| **Window** | **Fold when you leave** (`window:autosprout`) | Chuyển sang một app đang maximize hay fullscreen trên cùng màn hình với arcterm và ở đó khoảng 3 giây thì cửa sổ Full tự thu vào Sprout, nổi trên app đó; cửa sổ to nhưng không maximize, hộp thoại hay popup, app nằm cạnh, ở màn hình khác, chụp màn hình hay khoá máy thì không thu (trên macOS: một cửa sổ che từ 80% arcterm). Quay lại arcterm bằng cách nào cũng được (Alt+Tab, taskbar, bấm vào cửa sổ) thì cửa sổ tự mở ra. Mặc định tắt. Không thu khi đang ở Float, khi cửa sổ đang minimize, hay khi hộp thoại của arcterm (chọn file…) đang mở. Chuột phải nút **Sprout** trên app bar để bật/tắt nhanh. |
| **Vault & sync** | **Vault path**, **Sync remote** | Xem trên. |

Ba công tắc thông báo đầu mặc định bật; **Telegram** mặc định tắt.

### Appearance

| Thẻ | Mục | Ghi chú |
|---|---|---|
| **Theme** | Preset | Claude (mặc định), Graphite, Midnight, Slate, Carbon, Nocturne, One Dark, Monokai, Spider (bảng màu Claude với accent đỏ). |
| **Colors** | **Accent**, **Working / accept**, **Asking / attention**, **Blocked / reject** | Ghi đè màu vai trò; Accent có bảng màu sẵn và ô hex tùy ý. |
| **Fonts** | **Interface font** | Inter (mặc định), Hanken Grotesk, System UI. |
| | **Code font** | JetBrains Mono (mặc định), Hack, Fira Code. |
| **Jarvis** | **Character** | **Sprout** (mặc định), **Minion** hoặc **Spider-Man**: con vật đi trên footer, con Sprout thu nhỏ của Float và dấu trên thanh Float đều vẽ theo nhân vật này. Dấu và trang phục giống nhau cho cả ba. Spider-Man mặc bộ Homecoming khi làm việc và là Peter Parker khi rảnh; đi nghiêng trên footer, bắn tơ khi nói, treo trên tơ khi bị kéo, thỉnh thoảng bò ngược và treo dưới app bar (rê chuột vào là xuống), và ngồi trên nóc nhà khi gập cửa sổ. |
| **Jarvis** | Trang phục | **Flag shirt**, **Holds the flag** hoặc **Off**. Vào 30/4, 1/5 và 2/9 Jarvis mặc áo cờ kể cả khi tắt. |
| **Jarvis** | **Jarvis quotes** | Bật (mặc định): thỉnh thoảng, khi không có gì chờ bạn, Jarvis nói một câu danh ngôn về lập trình. |
| **Agent sidebar** | **Model**, **Branch**, **Tokens**, **Age** | Những gì dòng thứ hai của một agent trong sidebar hiện; mặc định bật hết. Tắt một mục chỉ ẩn nó khỏi hàng, rail vẫn có. Lưu trên máy này. |

### Terminal

Áp dụng cho mọi terminal của agent và shell.

| Thẻ | Mục | Mặc định |
|---|---|---|
| **Text** | **Terminal font** (JetBrains Mono, Hack, Fira Code) | JetBrains Mono |
| | **Font size** (px) | 14 |
| **Cursor** | **Cursor style**: Block, Bar, Underline | Bar |
| | **Cursor blink** | Bật |
| **Behavior** | **Scrollback** (số dòng lịch sử mỗi terminal, bước 250) | 1000 nếu chưa đặt |
| | **Copy on select** (bôi đen là copy luôn) | Tắt: bôi đen chỉ để đánh dấu chỗ đang đọc; copy bằng `Ctrl+C` khi đang có vùng bôi đen (`⌘C` trên Mac), không có vùng bôi đen thì `Ctrl+C` vẫn là interrupt |

### Agents

Gồm bốn thẻ: **Claude account**, **Sleep idle agents**, **Runs** (**Run route**) và **Launch flags**. Cách dùng ở phần "Làm thế nào" bên trên.

**Sleep idle agents** (bật sẵn, 30 phút): agent rảnh quá số phút này thì ngủ, tức tiến trình dừng để trả RAM nhưng hàng và hội thoại vẫn còn; **Wake**, hoặc một tin gửi tới nó, cho nó làm tiếp từ chỗ cũ. Khi RAM thiếu, agent rảnh lâu nhất ngủ sớm hơn. Không bao giờ ngủ: agent bạn đang xem, agent của run, agent còn việc chạy nền.

### Storage

Những gì arcterm và các agent để lại trên đĩa, và nút dọn từng phần. Đầu trang ghi tổng dung lượng và phần dọn được, nút **Rescan** và giờ quét gần nhất. Lần dọn nào cũng hỏi xác nhận trước, nói rõ cái gì đi và lấy lại bao nhiêu. Thứ đang dùng không bao giờ bị xóa: mục bị bỏ qua vẫn nằm trong danh sách, lý do ghi bên cạnh.

| Thẻ | Dọn gì | Ghi chú |
|---|---|---|
| **Run worktrees** | Worktree của run đã xong, trong thư mục cây chung của engine (`%LOCALAPPDATA%rc-wt`, `~/Library/Caches/arc-wt` trên Mac) và trong `.waveterm/worktrees` của từng project. Nhánh `wave/<run>` vẫn giữ. | Không bao giờ dọn worktree của run còn chạy hoặc còn đang land, hay cây engine đang xóa dở. Worktree có thay đổi chưa commit nằm ngoài **Clean all**: nút trên chính hàng của nó xóa sau khi xác nhận rằng các thay đổi đó sẽ mất. Cây trong `arc-wt` mà store của app này không có run của nó (của bản arcterm kia, dev hay bản cài, vốn dùng chung thư mục này, hoặc run đã xóa) cũng chỉ xóa bằng nút trên hàng của nó, không bao giờ bằng auto-clean. |
| **Old Claude sessions** | Transcript trong `~/.claude/projects` không đổi từ 7, 30 (mặc định) hoặc 90 ngày. | Chuyển vào `~/.arc/trash`, nằm đó 7 ngày rồi mới xóa hẳn. Session đang mở trong một tab được giữ. |
| **Logs, cache and trash** | Log đã cuộn (`waveapp.1.log`), thùng rác session và cache của giao diện. | Thùng rác bị xóa hẳn ngay. Cache được xóa lần sau arcterm mở. Bản dev trên macOS không có mục cache, vì nó dùng chung cache với bản cài. |
| **Build output** | `node_modules`, `target`, `dist`, `build`, `.next`, `__pycache__` mà git bỏ qua trong các project của bạn. | Mỗi project một nút **Remove**, không có Clean all. Thư mục có file git đang theo dõi không bao giờ bị xóa. Project có agent đang làm hoặc run đang chạy bị từ chối. |
| **Design canvases** | Các canvas `.dc.html` mà agent vẽ bằng design-local, trong `.superpowers/design` của từng project. | Thẻ chỉ ghi dung lượng, số canvas và nút **Open the gallery** (mở Agent → Canvas gallery), không liệt kê từng cái và không có Clean all. Canvas ở lại cho đến khi bạn dọn trong thư viện bằng **Clean up**, nơi bạn xem từng cái trước khi nó vào `~/.arc/trash`, nằm đó 7 ngày rồi mới xóa hẳn. |
| **Auto-clean** | **Clean the safe parts daily** (`storage:autoclean`, bật sẵn), **Remind me above** (`storage:nudgegb`, 2 GB), **Agents delete a canvas when its feature ships** (`storage:canvasonship`, tắt sẵn) | Mỗi ngày (lần đầu 2 phút sau khi mở app), dọn worktree của run đã xong không có thay đổi và log cuộn cũ hơn 7 ngày. Session, build output, canvas và cache chờ bạn. Khi dọn được nhiều hơn ngưỡng, một toast mở trang này, mỗi ngày tối đa một lần. Công tắc canvas không dọn gì theo lịch: agent đọc nó qua `wsh canvas policy`. Tắt thì agent giữ mọi canvas và chỉ liệt kê những cái đã ship khi bạn nhờ dọn; bật thì agent xóa canvas khi tính năng của nó đã ship. |

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
- **Thư viện tool** (lazygit, yazi, btop…) nằm ở Setup → Tools, không ở Settings: các tool bạn thêm được lưu trong `tools.json` ở thư mục `config`, cạnh `settings.json` (arcterm đọc lại khi file đổi). Danh sách tool ghim trong Open a tool chỉ lưu trên máy này. Cách dùng: [Agent → Tools](agent.md#tools).
- **Giới hạn và tiêu thụ quota**: [Usage](usage.md).
- **Cách chạy lệnh nặng** (`jobs:mode`, `jobs:slots`): lệnh nặng (build, typecheck, cả bộ test) của mọi agent và run xếp chung một hàng đợi. `jobs:mode` = `auto` (mặc định) cho chạy bao nhiêu cũng được miễn RAM còn đủ; `slots` giới hạn thêm ở `jobs:slots` lệnh cùng lúc (1–4, mặc định 1); `off` tắt hàng đợi, mọi lệnh chạy ngay. `jobs:pauseuntil` (Unix ms) tắt hàng đợi đến giờ đó, do nút **Pause 1h / 4h** ghi. Trên macOS, "RAM đủ" đọc theo memory pressure của hệ điều hành; trên Windows, theo commit charge so với RAM thật. Không có thẻ trong Settings: ghi bằng bộ chọn **Slots** ở popover của chip **Jobs** trên app bar, xem [Usage → Hàng đợi lệnh nặng](usage.md#hàng-đợi-lệnh-nặng).
- **Thẻ Token burn** (`tokengate:enabled`, `tokengate:sharepct`, `tokengate:windowpct`, `tokengate:agents`, `tokengate:weekpct`, `tokengate:sessionpct`): trước khi một agent Claude chạy `Agent`, `Task` hay `Workflow`, arcterm hiện thẻ **Token burn** trên terminal của nó khi lần spawn sẽ tốn từ `tokengate:sharepct` % cửa sổ 5 giờ (mặc định 10), khi cửa sổ đã dùng từ `tokengate:windowpct` % (mặc định 70), khi cửa sổ tuần đã dùng từ `tokengate:weekpct` % (mặc định 80), khi chính session đó, tính cả subagent của nó, đã dùng từ `tokengate:sessionpct` % cửa sổ 5 giờ (mặc định 25), khi nhóm khởi chạy từ `tokengate:agents` agent cùng lúc (mặc định 3), hoặc khi đó là một Workflow. Chi phí mỗi agent lấy từ các subagent cùng loại đã chạy xong (thẻ **Subagent cost** trong [Usage](usage.md)). Đặt một ngưỡng là `0` để tắt quy tắc đó; `tokengate:enabled` = `false` tắt hẳn thẻ. Không có thẻ trong Settings: ghi vào `settings.json`.
