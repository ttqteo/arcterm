# Jarvis: brief, run và initiative

Jarvis là surface điều phối (`Ctrl+2`, `Ctrl+G` `j`): một **Brief** cho biết việc gì đang chờ bạn, run nào đang chạy hay vừa land, và các initiative lớn đang đi tới đâu. Từ đây bạn mở run sheet, trả lời câu hỏi của lead và worker, duyệt spec và plan, và đặt mặc định cho các run sau.

Các trang liên quan: [Orchestrator](orchestrator.md) (cách một run chạy), [Plan file](plan-format.md), [Cockpit](cockpit.md) (thẻ agent và dải **Needs you**), [Agent](agent.md) (terminal của lead và worker), [Phím tắt](../keyboard-shortcuts.md#jarvis).

<!-- shot: jarvis-brief.png | Brief của Jarvis với vùng Waiting on you, các hàng initiative có thanh chunk và cột bên cạnh (Since you looked, Shipped) | Demo store, project acme-store; tạo một initiative bằng `wsh effort` và một run Quick đang chạy, rồi mở Jarvis -->

## Tour

Nút **?** trên header của Jarvis (cạnh **Profile**) mở bốn tour: **Brief**, **Initiatives**, **Run sheet** và
**Profile**. Mỗi bước làm sáng một chỗ trên màn hình kèm một thẻ giải thích, bằng tiếng Việt hoặc tiếng Anh (công tắc
**VI | EN** trên thẻ, được nhớ lại). `→` hoặc `Enter` sang bước kế, `←` về bước trước, `Esc` kết thúc. Tour tự mở
những gì bước cần (Profile, run sheet của run mới nhất) và đóng lại khi xong; bước nào không có gì để chỉ, như khi
chưa có run nào, hiện thẻ ở giữa màn hình. Lần đầu mở Jarvis, một thẻ nhỏ mời bạn xem tour Brief.

## Brief

Header của Brief có: chip **N waiting** hoặc **all clear**, ô lọc (`/`), chip autonomy (**All asks: to you**, **Routine asks: auto** hoặc **Mixed · K of N auto**; bấm để đổi mức), **Profile**, **?**, **New initiative** (`Shift+N`) và **New run** (`r`), nút nhấn mạnh duy nhất của surface, mở hộp khởi chạy run.

Dưới header, Brief có hai cột. Cột chính, từ trên xuống, mỗi vùng chỉ hiện khi có gì để hiện:

- **Waiting on you**: câu hỏi, cổng duyệt, task bị chặn, run cần accept. Dòng tóm tắt ở đầu vùng, rồi ba việc gấp nhất hiện sẵn, mỗi hàng có nút hành động ngay tại chỗ (**Approve**, **Answer**, **Open**, **Accept**); **+N more** (N là số việc còn ẩn) mở phần còn lại, **Show less** gập lại. Khi có hơn một run unverified, **Accept K unverified** ở đầu vùng nhận hết một lượt. Ẩn khi không có gì chờ (header ghi **all clear**). Huy hiệu trên nav rail đếm cùng các mục này.
- **Runs**: các run đang chạy, theo project (mỗi project có một channel). `Shift+J` / `Shift+K` chuyển giữa các run của channel.
- **Initiatives**: mỗi initiative là một hàng; xem [Initiatives](#initiatives).
- **From your sessions**: những ý được nêu trong các phiên cũ mà chưa ai quyết; xem [From your sessions](#from-your-sessions-ý-còn-bỏ-ngỏ-trong-các-phiên-cũ). Trước lần quét đầu, vùng này chưa hiện: một thẻ mời nằm dưới cột Ideas.
- **Ideas** và **For later**, cạnh nhau dưới danh sách initiative. **Ideas**: ý tưởng chưa có chunk. Gõ vào ô **Jot down an idea** rồi `Enter` để ghi nhanh một ý (`Esc` xóa ô); không cần form. **For later**: các phiên bạn đã đánh dấu **Mark for later**, mới đánh dấu trước, với **Resume** và **Done**.

Cột bên cạnh (340px) giữ phần đã qua:

- **Since you looked**: những gì đổi kể từ lần bạn nhìn gần nhất, chia theo loại. **Runs**: run bắt đầu, run xong. **Initiatives**: mỗi initiative một hàng cho cả khoảng thời gian (số note, chunk xong, chunk thêm), mới nhất trước, hiện 5 hàng rồi `+N initiatives`. **Records**: record và quyết định gộp thành một hàng đếm theo trạng thái; bấm (hoặc `Enter`) để mở danh sách. **Sessions**: một hàng khi một lần quét kết thúc sau lần bạn nhìn mà còn ý chờ quyết (`Scanned 21 sessions: 3 ideas to review`), nút **Review** nhảy tới vùng [From your sessions](#from-your-sessions-ý-còn-bỏ-ngỏ-trong-các-phiên-cũ). **Mark seen** (hoàn tác được) làm vùng này gọn lại.
- **Shipped · 7 days**: những gì đã ship trong bảy ngày qua, hiện ba mục rồi `+N more`.

Brief hẹp hơn 1100px thì cột bên cạnh rớt xuống dưới cột chính. Khi **Runs** hay **Initiatives** trống, vùng đó hiện một khung nét đứt với một câu và nút bắt đầu (**New run**, **New initiative**).

Cuối tiêu đề mỗi vùng có nút biểu tượng nhỏ **Show only** (bấm lại: **Show every region**) để xem riêng vùng đó; tiêu đề chỉ là nhãn, bấm vào không làm gì. `/` lọc các hàng của Brief (`Esc` xóa lọc), `j` / `k` đi giữa các hàng, `Enter` mở hàng dưới con trỏ, `r` mở run mới, `e` mở rộng dải record; footer liệt kê các phím này khi bạn ở Jarvis. Ô composer nhắn cho lead / worker nằm trong run sheet đang mở, không ở Brief ([Run sheet](#run-sheet)).

## Initiatives

Việc lớn hơn một run sống thành initiative (effort): một danh sách chunk, mỗi chunk có trạng thái và chuỗi ghi chú. Agent tạo và cập nhật chúng bằng `wsh effort` (skill `effort-tracking` dạy agent cách dùng; xem [Tích hợp agent](agent-integration.md#skills-đi-kèm)).

- Mỗi initiative là một hàng: tên và project, thanh các chunk kèm `done/total`, ghi chú **Next** hoặc **Blocked on**, ô trạng thái (**● blocked**, **● agent open**, hoặc ngày hoạt động gần nhất), nút **Work on** / **Go to agent** và menu ⋯.
- Thứ tự cho biết nên làm gì trước: initiative có chunk bị chặn hoặc có blocker lên đầu, rồi đến những cái đang có agent mở, rồi theo hoạt động gần nhất; initiative tạm dừng xuống cuối. Brief hiện tám hàng rồi `+N more`; **Show K archived** hiện các initiative đã lưu trữ.
- Bấm một hàng (hoặc `Enter`) để mở initiative ngay tại chỗ, không nhảy đi đâu: các chunk theo stage hiện dưới hàng, mỗi chunk một dòng gồm trạng thái, nhãn (tối đa hai dòng), số ghi chú và chữ trạng thái. Bấm chữ trạng thái để đổi trạng thái chunk; **Add chunk** và **New stage** ở cuối. `Alt+↑` / `Alt+↓` đổi thứ tự chunk trong stage, `Enter` mở chunk.
- **Work on** (`w`) mở một agent mới làm initiative, hoặc nhảy tới agent đã mở trên nó (nút khi đó đọc **Go to agent**). Bắt đầu run từ đó thì run được gắn vào chunk lúc tạo.
- Menu của hàng (luôn hiện): **Rename**, **Edit details…**, **Link to…** (hoặc **Unlink from …**), **Pause** / **Resume**, **Archive**, **Delete**.
- Một ý tưởng (initiative chưa có chunk) mở ra với **Plan it** (một agent chia ý tưởng thành chunk) và **Add first chunk** (biến nó thành initiative).

### Chunk do agent đề xuất

Chunk một agent đề xuất bằng `wsh effort chunk add --proposed` (**Plan it** cũng đề xuất) có trạng thái `proposed`: nó **không tính** vào `done/total` hay thanh tiến độ cho tới khi bạn chấp nhận. Chunk chờ hiện ở ba chỗ:

- Hàng initiative ghi `N proposed` dưới ô trạng thái; hàng ý tưởng ở cột Ideas ghi cùng chữ đó.
- Mở initiative (hoặc ý tưởng) ra thì có nhóm **Proposed · N** với từng chunk và ba nút ✓ **Accept** (thành `pending`), ✎ **Rename** và ✕ **Drop**, cùng **Accept all** và **Drop all** cho cả nhóm. **Drop** ở Brief có vài giây để **Undo** trước khi chunk bị xóa thật. Một ý tưởng bị **Drop all** vẫn là ý tưởng.
- **Waiting on you** có một mục `plan` cho mỗi initiative còn chunk chờ (đọc `N proposed`, nút **Open**): nó mở agent đã đề xuất khi agent còn mở, không thì mở initiative. Hàng đó cũng hiện ở popup của Sprout (**Plan to review**) và đếm vào huy hiệu như các việc chờ khác.

Khi agent còn mở, bạn quyết định ngay trên rail của nó: [Agent → Plan to review](agent.md#plan-to-review-trên-rail).

### Initiative con

Một initiative có thể là **một phần của** initiative khác. **Link to…** trong menu ⋯ của hàng mở picker (không liệt kê chính nó và những gì nằm dưới nó); chọn một initiative thì hàng chuyển xuống dưới initiative đó. **Unlink from …** đưa nó về cấp trên cùng; cả hai đều có **Undo** trong toast. Server từ chối một liên kết làm initiative nằm dưới chính nó (`that would put the initiative under itself`).

- Initiative con nằm ngay dưới cha, thụt vào và có khuỷu nối lên cha; dòng phụ đọc `↳ Part of <cha>`. Hàng cha ghi `+N sub` sau tên.
- Mở hàng cha thì dưới nó có **Sub-initiatives** (tên, `done/total`, trạng thái) và **Ideas** liên kết với nó (kèm `N proposed` nếu có); bấm một dòng để mở hàng đó.
- Cha bị xóa thì các con của nó vẫn hiện, thành hàng cấp trên cùng.

### Review: cái gì đổi, cái gì nằm yên

Tiêu đề vùng **Initiatives** có nút **Review · N** khi có initiative cần nhìn lại (không có thì không hiện; review không gấp nên không đếm vào huy hiệu). Hai loại:

- **Changed**: đổi kể từ lần bạn đánh dấu **reviewed** nó (initiative chưa từng review thì tính từ lần "Since you looked"). Hàng của nó có chấm màu accent trước tên.
- **Idle**: đang `active`, không agent nào làm, và không đổi cũng không được review trong 14 ngày. Ô trạng thái của hàng đọc `idle 3w`.

`v` hoặc **Review · N** bắt đầu một lượt đi qua hàng đợi theo thứ tự: bị chặn, đang chờ bạn, đang có agent làm, changed, rồi idle. Mỗi lúc một initiative mở ra, các cái còn lại là một dòng kèm lý do (`blocked`, `asks you`, `at work`, `changed`, `idle`):

- Khối **Since you reviewed** liệt kê những gì xảy ra từ lần đánh dấu trước (chunk xong, chunk thêm, đổi trạng thái, ghi chú); một initiative idle ghi `nothing moved in N weeks and no agent is on it`.
- Nút: **Keep going** (đánh dấu rồi sang cái kế), **Go to agent** hoặc **Work on**, **Pause** / **Resume**, **Archive**, và **Mark reviewed** (`Enter`). Initiative idle xếp **Pause** và **Archive** lên đầu. **Pause** và **Archive** cũng đánh dấu cái đó là đã review.
- `j` / `k` (hoặc `←` / `→`) đi qua lượt mà không động tới con trỏ của danh sách; `Esc` hoặc **Exit review** rời đi. Hết hàng đợi thì đọc **All reviewed**. Lượt còn nguyên khi bạn sang surface khác rồi quay lại; dấu đã review thì được nhớ giữa các lần mở app.

Popup của Sprout có một dòng `N initiatives changed · M idle` với **Review in Jarvis**: bấm nó mở Jarvis ngay trong lượt review.

### Panel của chunk

Bấm một chunk (hoặc `Enter` trên nó) mở panel của chunk. Khi Brief rộng từ 1281px, panel thế chỗ cột bên cạnh và cột chính giữ nguyên bề rộng; hẹp hơn, panel nổi lên trên Brief. `Esc` đóng panel (một ghi chú đang mở thì `Esc` gập nó trước).

- **Header**: `n / tổng`, ↑ ↓ (`k` / `j`) đổi chunk, **Work on this chunk**, **Copy wsh command** (lệnh `wsh effort note …` đầy đủ nằm trong tooltip) và ✕.
- **Thân**: initiative (và stage, với plan chia stage) ở dòng nhỏ phía trên, nhãn chunk, dòng `N notes · last Oct 9 · Activity ↗`, hàng sáu trạng thái, rồi chuỗi ghi chú. Ô ghi chú ghi **Add a note…**; `Ctrl+Enter` thêm, `Esc` xóa. Một ghi chú gắn với run không còn đọc được hiện "The run's report is no longer available."
- **Work on this chunk** mở một agent chỉ làm chunk này: đọc ghi chú của nó, làm, ghi kết quả thành một ghi chú của chunk và đánh dấu xong. Khi đã có agent mở trên initiative, nút đọc **Go to agent** và chỉ nhảy tới agent đó.

Run và chunk nối với nhau thế nào, và ai đóng chunk khi run xong: [Orchestrator → Initiative qua nhiều run](orchestrator.md#initiative-qua-nhiều-run).

## From your sessions: ý còn bỏ ngỏ trong các phiên cũ

Điều đã quyết thì nằm trong file (spec, plan, `deferred.md`, commit). Điều được nêu giữa một phiên rồi bỏ ngỏ thì chỉ còn trong transcript, mà Claude Code xóa transcript sau `cleanupPeriodDays` (arcterm đặt 90 ngày khi bạn chưa đặt giá trị riêng). **From your sessions** đọc các phiên cũ, đưa những ý chưa ai quyết trở lại Brief, nơi bạn vốn nhìn, và giữ chúng trước khi transcript mất. Không có tab hay surface riêng.

### Quét gì, khi nào

- **Chỉ phiên Claude Code.** Mỗi phiên là một lượt gọi haiku, không công cụ, đọc bản digest của phiên (cùng file mà tìm kiếm Conversation History đọc), không đọc transcript thô. Lượt gọi nhận kèm initiative đang mở của project, chunk, ý đã có, tên spec và plan, các đề mục của `deferred.md` và tiêu đề commit; một ý đã khớp một trong số đó thì bị bỏ.
- **Bỏ qua:** phiên của chính máy móc arcterm (worker, reviewer, judge của engine, ghế council, builder check và judge của brainstorm), phiên mới ghi trong 2 ngày qua (còn đang viết; hiện ở **Sessions scanned** là `still being written`), phiên không có prompt nào của bạn, và các agent mà chính tính năng này mở để bàn một ý (prompt đầu của chúng bắt đầu bằng `[arc:session-ideas]`), để lần quét sau không đề xuất lại ý từ cuộc bàn về nó.
- **Mỗi phiên quét một lần.** Phiên dài thêm sau lần quét thì được đọc lại, chỉ phần lượt mới.
- **Không có gì được quét trước khi bạn bấm Scan my sessions.** Trước đó Brief chỉ hiện thẻ mời **Ideas you floated and left** dưới cột Ideas, kèm ước lượng (`haiku · about 210k tokens for 21 sessions`; 10.000 token một phiên là con số đoán, lần quét đầu ghi số thật) và **Not now** để cất thẻ đến lần mở app sau. Khi có từ hai project trở lên, chip **project all ▾** cạnh nút cho chọn quét một project trước (ví dụ mit-thesis); ước lượng và nhãn nút (**Scan mit-thesis**) đổi theo project đã chọn. Mỗi project mang tên thư mục mà phiên được mở trong đó (`SIEM/src`, `~` cho thư mục home); từ tám project trở lên, menu là một ô tìm theo tên hoặc đường dẫn (↑ ↓ chọn, Enter quét, Esc đóng). Thư mục của chính arcterm (worktree của run, thư mục temp) không có trong menu và không bị quét. Cả lần quét bắt buộc cho phiên sắp bị xóa cũng chờ bạn bấm: nó tốn token mà bạn chưa thấy ước lượng. Nếu có phiên sắp bị xóa mà chưa quét, thẻ nói rõ ngày.
- **Quét từng project thì lịch tự quét chỉ chạy cho project đó.** Sau khi quét riêng một project, thẻ mời vẫn ở lại cho các project khác (ghi `Scanned so far: mit-thesis`), header của vùng ghi `mit-thesis only`, và **Scan now**, **Retry** cùng lịch tự quét chỉ đọc các project đã quét. Chọn **all** một lần thì từ đó lịch phủ mọi project và thẻ mời biến mất.
- **Sau lần quét đầu, arcterm tự quét.** wavesrv kiểm tra mỗi 5 phút (chỉ đọc giờ ghi của file và dấu đã quét). Ngày xóa của một transcript là lần ghi cuối cộng `cleanupPeriodDays` đọc từ `~/.claude/settings.json`; lượt quét của nó đến hạn 10 ngày trước đó và chờ một **cửa sổ 5 giờ còn dư quota** theo cổng của [DUM-E](dume.md) (cửa sổ gần reset còn quota, không run nào đang sống, máy không thiếu RAM), phiên gần ngày xóa nhất đọc trước. Phiên còn 7 ngày hoặc ít hơn mà chưa quét thì quét ngay, không đợi cửa sổ.
- **Scan my sessions / Scan now / Retry** là lượt quét bạn tự bắt đầu: nó đọc mọi phiên đã yên mà chưa quét, đến hạn hay chưa (trong project đã chọn, hoặc các project đã quét nếu bạn mới quét từng project).
- Ý, dấu đã quét và tiến trình nằm trong `sessionideas/state.json` của thư mục data.

### Vùng trên Brief

Vùng nằm giữa **Initiatives** và hàng **Ideas** / **For later**. Header: nhãn, số ý chờ, dòng `scanned Nov 24 · 210k tokens · next by Dec 1` (token của lần quét cuối; khi đang quét thì đếm token đã dùng), **Scan now**, **Go through N with an agent**, **Show only**.

Mỗi ý là một hàng: câu tóm tắt một dòng (tiếng Anh), nơi nó sẽ đặt (tên initiative, hoặc `New idea · <project>`), và:

- **What was said**: mở các câu trích nguyên văn (của bạn hay của Claude), phiên nguồn, ngày nói, và ngày transcript bị xóa (`transcript leaves Dec 1`); **Open session** mở phiên đó trong Library.
- **Keep**: đặt thành chunk `pending` trên initiative của nó, hoặc thành một ý mới ở cột Ideas khi không initiative nào khớp. Câu trích và id phiên thành ghi chú đầu của chunk, nên ý còn nguồn khi transcript đã mất. Một toast nói nó đã đặt vào đâu. Nếu initiative đã có chunk cùng nhãn, server từ chối (`chunk … already exists`) và ý ở nguyên chỗ; `wsh sessionideas keep <id> --label "…"` đặt nhãn khác.
- **Drop**: bỏ ý; các lần quét sau không đề xuất lại.
- **Discuss**: mở một agent sonnet **trong project của ý** (không có project thì No folder), nhận câu tóm tắt, câu trích, initiative và id phiên nguồn. Nó đọc thêm bằng `wsh read session:<id>`, không bao giờ `--resume` (resume một phiên nguội ghi lại toàn bộ cache). Khi agent còn mở, nút đọc **● Go to agent** và nhảy tới nó, không mở agent thứ hai. Agent chỉ ghi quyết định (`wsh sessionideas keep|drop`) sau khi bạn nói.
- **Go through N with an agent** (header): một agent sonnet **ở No folder** đi qua từng ý với bạn, mỗi lúc một ý, và ghi mỗi quyết định. No folder vì các ý trải nhiều project và một lượt nhanh không cần AGENTS.md hay skill của project nào; ý cần đọc code thì agent để lại cho Discuss. Khi một agent giữ mọi ý đang chờ, nút đọc **● Go to agent**.

Khi hết ý, vùng đọc `Nothing left open in the sessions scanned so far.` Các trạng thái trong vùng:

- **Đang quét**: dải tiến độ `Reading session 3 of 21` với **Stop**.
- **Dừng giữa chừng** (bạn bấm Stop, hoặc lỗi model): thẻ đỏ `You stopped the scan at session 7 of 21.` hoặc `The scan stopped at session 7 of 21: <lỗi>`; những gì đã tìm vẫn ở dưới, **Retry** đi tiếp từ phiên đó.
- **Phiên sắp bị xóa mà chưa quét**: thẻ vàng `2 sessions are deleted on Dec 1 and have not been scanned.`

**Sessions scanned** gập ở cuối vùng: thanh phủ sóng của các phiên còn trên đĩa (`scanned`, `not yet`, `leave within 7 days`, mỗi phần kèm số) rồi từng phiên với kết quả của nó: `3 ideas · above`, `1 idea · kept`, `nothing left open`, `not scanned`, `still being written`. Phiên chưa quét xếp đầu, gần ngày xóa nhất trước. Phiên chưa có dấu đã quét không có tên (hàng đọc bằng id ngắn).

### Nghe tin về nó

- Một **toast** khi lần quét kết thúc có ý mới: `Session scan: 2 ideas to review, from 21 sessions`, nút **Review** mở vùng.
- Hàng **Sessions** của **Since you looked** (ở trên).
- Sau **7 ngày** có ý chờ mà không ai mở vùng, **Waiting on you** có một hàng `Session ideas`: `3 ideas from your sessions, waiting 8 days`, với **Review** (mở vùng) và **Next week** (hoãn 7 ngày). Hàng này đếm vào huy hiệu như các việc chờ khác. Mở vùng mà chưa quyết cũng tính là đã nhìn: 7 ngày bắt đầu lại. Hết hạn hoãn mà ý còn chờ thì hàng quay lại ngay.
- Nav rail không có chấm cho tính năng này.

### Sprout

Popup của [con vật Jarvis](#con-vật-jarvis-và-popup-việc-chờ) thêm một dòng dưới các việc chờ: `N ideas from your sessions to review · Review in Jarvis`. Nó không phải một hàng hàng đợi, nên không đếm vào huy hiệu. Dưới dòng là các chip cố định, mỗi chip làm một việc và không chip nào đợi một model trả lời:

- **What's waiting?**: liệt kê các ý ngay trong popup (tóm tắt, initiative, và ngày transcript bị xóa khi gần).
- **Go through N with an agent**: mở agent No folder như nút ở header vùng.
- **Discuss: <tóm tắt>**: Discuss cho ý đầu tiên, ý có transcript bị xóa sớm nhất.
- **Which lose their transcript soon?**: chỉ hiện khi có ý như vậy (xóa trong 7 ngày); danh sách đã lọc.

Chip đã chạy thì hàng của nó thành `Session ideas · No folder · sonnet · started` với **Go to agent**, và bấm không mở agent thứ hai. Mỗi lần bấm một chip ghi một dòng `sessionideas: pick chip=… at=…` vào `waveapp.log`, để chip không ai bấm có thể bỏ theo số liệu. Khi Sprout ở dạng gập (không nổi), popup chỉ giữ dòng ý và **Review**, không có chip.

Câu hỏi gõ là đường phụ: lời nhắc của ô hỏi Jarvis liệt kê cả các ý đang chờ, nên một câu chip không phủ (`ý nào liên quan Sidecar?`) được trả lời từ danh sách đó; `duyệt giúp tôi` hay `bàn ý <x>` đi qua `arc-route` tới đúng hai agent trên (sonnet, prompt bắt đầu bằng `[arc:session-ideas]`).

### Storage và 90 ngày

Hộp xác nhận **Move sessions to the trash** của thẻ Sessions trong **Settings → Storage** nói bao nhiêu phiên trong số sắp chuyển chưa bao giờ được quét (`3 of them were never scanned for ideas.`). Sau lần quét đầu nó thêm **Scan them first**: quét đúng các phiên đó và không chuyển gì; **Move to trash** vẫn chuyển chúng khi chưa quét. Trước lần quét đầu hộp chỉ cho biết con số.

Tìm kiếm Conversation History cũng với tới 90 ngày, bằng thời gian transcript được giữ, thay vì 30. Bản digest của 90 ngày được dựng lần đầu một tìm kiếm cần tới và bởi một lượt khởi động nền.

Mỗi lần quét tốn một lượt haiku mỗi phiên; Discuss và Go through là một phiên sonnet bình thường, không phải một fan-out.

## Councils

Vùng **Councils** nằm dưới **Runs**: mọi council còn đang chạy ở mọi project, cùng các council đã kết thúc trong tuần,
cái đang chờ bạn lên đầu. Bấm một hàng để mở council, mở thẳng báo cáo khi đã có. Xem [Council](council.md).

## Run sheet

Mở một run từ **Waiting on you**, **Runs**, **Shipped**, hoặc Conversation History. Từ trên xuống:

- **Verb** và dòng phụ: Planning, Starting, Working, Final check, Wrapping up, Landing, Waiting on you, Blocked, Done, Cancelled. Một run Done mà land đang chờ đọc **Landing**, kể cả khi land đang xếp hàng sau land khác của project (dòng phụ: *#2 in line to merge wave/… into main*) hay khi một resolver đang merge base vào branch của run (*a resolver is merging main into wave/…*): cả hai tự land, không cần bạn; land bị giữ đọc **Waiting on you** kèm lý do.
- **Thanh tiến độ** (mỗi task một đoạn, rồi ba chấm cuối cho **Final check**, **Wrap-up** và **Land**: mọi task xanh mà ba chấm chưa xong thì run chưa xong) và các chip: thời gian đã trôi, worker-time, landed, answered, forwarded, unverified, **N needs you**.
- **Dòng cấu hình**: `engine · orchestrator · lead … · parallelism … · workers …` với **Adjust** để đổi độ rộng và route cho các dispatch sau.
- Dòng **started from** *tên session*, dưới goal, khi run do một session bắt đầu bằng `wsh runs start`: bấm để về session đó (terminal khi còn sống, transcript khi đã kết thúc).
- **Questions for you**, khi bạn đang giữ câu hỏi: câu hỏi đứng đầu phần thân của sheet, trên cả Tasks, để việc cần bạn không bị đẩy xuống dưới các số đo.
- **Tasks**: mỗi task một hàng với trạng thái và một hành động: **Open in Agent ↗** cho worker đang sống, **View child run** cho task đã xong, **Open DAG ↗** cho task kẹt ở merge. Sau đó là dòng `next:` nói run đang đợi gì.
- **▸ timeline**: mọi sự kiện của run, mới nhất trước; **open the full timeline ↗** mở nó trong DAG view. Khi run cần bạn, timeline là phần hữu ích nhất.
- **Timing** (run orchestrator): mỗi hoạt động một thanh (Planning, Execution, Task review, Merge & Verify, Final verification, Landing / wrap-up) trên trục tính từ lúc khởi chạy. Thu gọn khi run đang chạy, mở khi run đã xong. Các hoạt động chồng lên nhau nên cộng lại không bằng tổng.
- **Final check**: ảnh chụp của vòng final stage gần nhất, khi plan có lệnh Final (xem [Final check](#final-check)).
- **Dock**: **Open DAG**, **Open lead ↗** và **Open in Agent ↗** (hai nút liền nhau trong một nhóm **Open**), **Cancel run**. Dock có nhiều nhất một nút nhấn mạnh, là việc đầu tiên đưa run đi tiếp: **Land again**, **Resume**, hoặc **Open DAG** cho một merge bị giữ.
- **Composer** dưới dock, khi run đang sống: nhãn **Message the lead** (hoặc **the worker**) kèm phím `i`, nhắn thẳng vào terminal của lead hay worker. `i` vào ô, `Esc` rời ô, `Esc` lần hai đóng sheet.

`j` / `k` chuyển sang run kế / trước trong danh sách mà sheet đang đếm. Khi run xong, sheet thành mặt **Done**: báo cáo của lead hoặc **what landed** cùng bằng chứng đã niêm phong ([Orchestrator → Kết thúc run](orchestrator.md#kết-thúc-run)).

![Run sheet của một run orchestrator đang Working: thanh tiến độ với ba chấm cuối, danh sách task với lý do chưa chạy, dòng next:, Timing và dock](images/jarvis-run-sheet.png)

### Final check

Khi plan có lệnh **Final** chụp ảnh (như `final-verify.mjs` của repo này), dòng **Final check** của run sheet mở hộp xem ảnh: danh sách scenario bên trái, ảnh của scenario đang chọn, và các bước pass / fail / skip.

| Phím | Làm gì |
|---|---|
| `↑` / `↓` | Scenario trước / kế |
| `←` / `→` | Ảnh trước / kế của scenario |
| `z` | Vừa khung / kích thước thật |
| `s` | Hiện hoặc ẩn các bước |
| `Esc` | Đóng hộp xem; run sheet vẫn mở |

Khi hộp mở, đây là các phím duy nhất của cockpit: surface bên dưới không động. Ảnh đã bị xóa khỏi đĩa hiện **No longer on disk**.

## Trả lời câu hỏi của lead và worker

Lead và worker được dặn đưa mọi câu hỏi và phê duyệt qua công cụ hỏi của harness, nên chúng hiện ở **Waiting on you** (và trên Cockpit, popup của con vật Jarvis, palette scope **Needs you**) thay vì trôi qua trong terminal.

- **Chọn một lựa chọn**: bấm vào nó. Thẻ một câu hỏi, chọn một thì gửi ngay khi bấm. Câu hỏi của worker trong một task nhận phím `1`–`9` và `Enter` trên run sheet.
- **Trả lời bằng lời của bạn**: gõ trong terminal của agent trên surface Agent (picker của harness có lựa chọn tự gõ).
- **✕** bỏ qua câu hỏi.

Câu hỏi một worker không tự giải được thì lead xử lý trước; chỉ câu lead không nên quyết mới được **forward** cho bạn, kèm task nó thuộc về.

## Hộp Spec review và Plan review

**Spec review** của lead, và **Plan review** khi plan hỏng review hai vòng ([Orchestrator → Review plan](orchestrator.md#review-plan)), mở thành một hộp phủ lên surface bạn đang ở: tài liệu bên trái, các quyết định (hoặc phát hiện) cần bạn chấp nhận bên phải, và **Approve** (với plan là **Accept all and proceed**, `Ctrl+Enter`) hoặc **Request changes** ở đáy.

- **Request changes** nhận một ghi chú và gửi cho lead làm câu trả lời của bạn.
- **Trích dẫn**: bôi đen một đoạn trong tài liệu, ô ghi chú mở dưới đoạn đó (`Enter` thêm, `Esc` bỏ). Đoạn được tô sáng, các ghi chú gom dưới phần quyết định (bấm để mở lại, **✕** để xóa). Hai nút đổi thành **Approve with N notes** / **Request changes · N notes**, và lead nhận một câu trả lời: lời bạn hoặc nhãn approve, rồi từng đoạn trích trên dòng `> ` với ghi chú bên dưới, theo thứ tự tài liệu.
- Ở chỗ khác (thẻ lead trên Cockpit, Brief, run sheet) review hiện thành một dòng tóm tắt với nút **Review**. Trên surface Agent, hàng của lead có tag `review`, header có chip `Spec review` / `Plan review` màu hổ phách, và `r` mở hộp trên lead đang focus. Hộp tự mở một lần cho mỗi lần hỏi, khi bạn focus chính lead đó và không đang gõ trong terminal.
- `Esc` ẩn hộp mà vẫn để câu hỏi mở; hộp đóng hẳn khi lead nhận câu trả lời.

![Hộp Spec review: tài liệu render bên trái với một đoạn được tô sáng, ghi chú bên phải, nút "Approve with 1 note"](images/jarvis-review-dialog.png)

## Profile: mặc định của run và nguyên tắc

Nút **Profile — run defaults** trên Jarvis mở hai phần:

**Run defaults** (cách run mới được dựng). **Scope** là **Global** (mọi project kế thừa) hoặc **Project** (chỉ project này; trường nào để **Same as global** thì lấy giá trị toàn cục):

| Trường | Ý nghĩa |
|---|---|
| **Default shape** | **Quick** hoặc **Orchestrator** cho hộp New |
| **Lead route** | Harness và model của lead (và worker của phase) |
| **Worker route** | Nơi worker của engine chạy: **Same as lead**, một route, hoặc **Reviewer picks** |
| **Reviewer route** | Nơi chạy review từng task, review plan và final verify |
| **Parallel workers** | Số worker chạy cùng lúc (**Auto** để lead chọn) |
| **Runs land on** | **Own branch** (mặc định, `wave/<runId>`) hoặc **Project checkout** |

Thay đổi chưa lưu ghi **Unsaved changes · apply to future runs**; lưu bằng **Save profile** (hoặc **Save global profile**). Chỉ run khởi chạy sau đó dùng giá trị mới. Cờ của `wsh runs start` thắng profile, và `wsh runs route` in ra route mà run mới sẽ dùng cùng nguồn của từng cái. Cách các route quyết định model của từng task: [Orchestrator → Chọn route và model](orchestrator.md#chọn-route-và-model).

**Principles**: các nguyên tắc ngắn được đưa vào prompt của lead. Có danh sách toàn cục (**New principle…**) và phần **This project**, nơi bạn sửa riêng câu chữ của một nguyên tắc cho project (**Customized**), tắt nó (**Disabled for this project**), hoặc thêm nguyên tắc chỉ của project.

## Con vật Jarvis và popup việc chờ

Con vật pixel đi dọc footer trên mọi surface là cách nhìn nhanh Waiting on you: nét mặt và tư thế đổi theo tình hình, nhưng không hiện số. Nó mệt khi quota 5 giờ hoặc quota tuần sắp cạn, và nói một lần khi một cửa sổ vượt 85% và một lần khi hết hẳn; RAM đầy chỉ là một dòng trong popup, không làm nó mệt. Khi máy ngủ trong lúc agent đang chạy, lúc thức dậy nó nói máy đã ngủ bao lâu, từ mấy giờ đến mấy giờ và bao nhiêu agent bị dừng theo. Thỉnh thoảng (45 đến 90 phút một lần), khi không có gì chờ bạn, nó nói một câu danh ngôn về lập trình; tắt ở **Settings → Jarvis & Office → Jarvis quotes**. Nó tránh chỗ có toast, và khi bạn thả nó ra thì nó rơi về footer.

- Bấm vào nó, hoặc `Ctrl+G` `w`, mở **popup việc chờ**: duyệt cổng, retry task hỏng, accept kết quả unverified, land lại một run bị giữ (hoặc **Dismiss** nó), và trả lời câu hỏi của agent ngay tại chỗ. Câu hỏi một lựa chọn trả lời bằng `1`–`9`. Câu hỏi nhiều câu hoặc chọn nhiều có nút **Answer** (hoặc `Enter`) mở form trả lời dưới hàng, giống form trên thẻ Cockpit: `1`–`9` chọn, `←` / `→` chuyển câu, `Enter` gửi khi mọi câu đã có đáp án, `Esc` thu form. Doc review vẫn mở bằng **Open**.
- Bấm vào bong bóng **Needs you** (hoặc mở popup khi bong bóng đang hiện) thì con trỏ nằm sẵn trên câu hỏi đó, form của nó mở sẵn.
- **Peek**: `Space` trên một hàng, hoặc `Ctrl`+bấm một liên kết, mở run, agent, record hay initiative trong popup mà không đổi lựa chọn ở surface dưới. `Backspace` về màn đầu, `Enter` mở mục đó ở chỗ của nó.
- Khi có ý chờ từ các phiên cũ, popup có thêm một dòng và vài chip dưới các việc chờ ([Sprout](#sprout)).
- Nó "nói" khi một run land, khi có bản Claude Code mới (một lần), và khi một việc mới cần bạn.
- Trang phục đổi ở **Settings → Jarvis & Office**.

Phím đầy đủ của popup và peek: [Phím tắt](../keyboard-shortcuts.md).

## Xem thêm

- [Orchestrator](orchestrator.md) — run từ đầu tới lúc land, DAG view, khôi phục.
- [Cockpit](cockpit.md) — thẻ agent, dải Needs you, thông báo.
- [Tích hợp agent](agent-integration.md) — `wsh runs`, `wsh effort`, `wsh ask`.
