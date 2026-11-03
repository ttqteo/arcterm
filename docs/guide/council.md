# Council

**Council** là một nhóm agent chuyên gia cùng xử lý một câu hỏi qua ba vòng: mỗi người đưa ý, đọc và cãi ý của nhau, rồi
người điều phối (coordinator) tổng kết. Khi đang chạy, council hiện thành một nhóm chat; khi xong, nó thành một bản báo
cáo kèm cả cuộc thảo luận. Dùng nó khi bạn đang phân vân giữa hai hướng mà chưa hướng nào thắng, vừa viết xong một spec
hay plan, hoặc sắp nộp một bản nháp và muốn nhiều góc nhìn trước.

Council nằm trên surface [Agent](agent.md): nó có hàng riêng trong cây project và phủ lên chỗ của terminal giống
Conversation History. Các trang liên quan: [Brainstorm](brainstorm.md), [Jarvis](jarvis.md) (vùng Councils),
[Usage](usage.md) (thẻ Token burn) và [Phím tắt](../keyboard-shortcuts.md#agent-council-chat).

## Hai chế độ

| Chế độ | Khi nào | Báo cáo cho ra gì |
|---|---|---|
| **Review** | Đánh giá một thứ đã có: một tính năng, spec, plan, bản nháp | Một câu trả lời, tối đa ba hướng đi xếp hạng, mỗi hướng có bước đầu tiên; phần còn lại nằm dưới **Also raised**, mỗi ý một dòng |
| **Brainstorm** | Một vấn đề hay một mục tiêu chưa có lời giải | Tối đa ba ý đáng thử, mỗi ý có bước đầu tiên; các ý táo bạo được để riêng |

arcterm tự chọn chế độ theo câu hỏi của bạn; chip chế độ trong **New council** cho bạn đổi lại.

## Mở một council

- **Từ hộp thoại New** (`Ctrl+N`): chọn **Council** và một project, rồi **Set up council**. Search → Start → "New
  council…" cũng mở đúng màn đó.
- **Ngồi chung với các agent đang chạy**: trong cây Agent, `Ctrl`+click (hay `Shift`+click) để chọn hai agent trở lên,
  chuột phải → **Discuss together**. Màn Setup mở với các agent đó đã được xếp ghế.
- **Nhờ agent tự mở**: agent Claude có skill `arc:council`. Nó tự mở council khi cuộc trò chuyện có một câu hỏi thật sự
  còn bỏ ngỏ, và mở ngay khi bạn bảo "hỏi council". Khi council xong, agent tóm tắt báo cáo ngay trong cuộc trò chuyện.

Màn **Setup** là một ô duy nhất: viết bạn muốn review hay hỏi gì, các tùy chọn nằm bên dưới. Nút **Auto-generate** viết
sẵn chủ đề, câu hỏi và chế độ từ những gì các agent được xếp ghế vừa nói với nhau, và hỏi trước khi ghi đè chữ bạn đã
viết. Dòng chi phí cho biết council này tốn khoảng bao nhiêu token; một council thường tốn khoảng 0,5–1,5M token và phải
qua thẻ **Token burn** như một lần mở subagent tốn kém.

Mỗi lúc chỉ chạy một council, tính chung mọi project. Council bạn mở khi đang có cái khác chạy sẽ hiện **Queued** trong
cây, có thể gỡ khỏi hàng đợi, và tự bắt đầu khi cái đang chạy kết thúc hoặc dừng lại chờ bạn.

## Ghế ngồi

Một council là một **nhóm** gồm các chuyên gia theo vai và một người tổng kết. Có năm nhóm dựng sẵn:

| Nhóm | Chuyên gia | Người tổng kết |
|---|---|---|
| Review a UI feature | UX, RAM, người mới dùng, Skeptic | Coordinator |
| Paper review | hai reviewer, một người đọc | Area chair |
| Product ideas | người mới dùng, designer, builder, Contrarian | Facilitator |
| Chats with a Skeptic | các chat bạn chọn + Skeptic | Coordinator |
| Chats with a Contrarian | các chat bạn chọn + Contrarian | Facilitator |

Hai nhóm cuối dành cho council có xếp ghế cho chat. Bạn thêm vai của riêng mình trong `councilroles.json`, nằm trong
thư mục config. Ngoài các vai, council còn xếp được ghế cho các **chat đang sống** của bạn:

- Một agent claude hay pi đang chạy được ngồi như một ghế và trả lời bằng context của chính phiên đó. Với council do bạn
  mở trong app, mỗi câu trả lời của nó nằm chờ dưới dạng bản nháp: **Send to the others** (gửi cho cả nhóm), **Edit** hoặc
  **Drop**.
- Council có ghế agent mà do một agent mở (`wsh council start --agent <tab id>`, `--agent self` cho chính chat đang hỏi)
  thì chạy thẳng tới báo cáo, không giữ bản nháp lại.
- **Thêm một chat vào council đã có**, đang chạy hay đã xong: gõ `@` trong ô nhắn của council, chọn chat dưới **Add a
  live chat** (danh sách có id ngắn, tiêu đề, project và lượng context nó đang giữ) rồi gửi. Chat đó vào nhóm, trả lời
  tin nhắn này từ context của nó và ở lại làm một ghế.

Trong cây Agent, agent đang ngồi trong một council đang chạy hoặc đang chờ bạn ghi `in council` trên hàng của nó.

## Đọc cuộc thảo luận

Phần **Discussion** là một nhóm chat. Mỗi ý là một tin nhắn trong bong bóng mang màu của chuyên gia viết nó, avatar có hai
chữ cái (ĐV, KT) để phân biệt những ghế có tên đầu giống nhau. Hết một vòng thì ý của các chuyên gia xen nhau theo lượt,
và mỗi câu trả lời nằm dưới phần trích của ý mà nó đáp lại. Câu hỏi của bạn nằm bên phải, gấp còn ba dòng, các giới hạn
bạn đặt thành chip.

- **Thread**: chip trả lời trên một ý mở thread của nó trong panel bên phải.
- **Lọc theo ghế**: các ghế trên cùng là bộ lọc, mỗi ghế có số tin nó đã viết; ghế đang làm việc chỉ hiện một chấm, rê
  chuột để xem nó đang làm gì.
- **Top**, **Latest**, rồi **Back**: ba nút ở góc dưới bên phải kênh để nhảy lên đầu, xuống tin mới nhất, và quay về chỗ
  bạn đang đọc.
- **Câu bắt buộc đọc**: trong một ý hay câu trả lời dài, chuyên gia đánh dấu một hai câu bạn phải đọc, và chúng được tô
  vàng như trong terminal. Chuyên gia cũng có thể dùng bảng nhỏ, danh sách đánh số hay flowchart khi trình bày như vậy dễ
  đọc hơn; bảng có nút copy.
- **File được trích**: mỗi file mà một tin nhắn trích là một chip nhỏ có số dòng (`huong_harness.md:65`); quá hai file
  thì phần còn lại gấp vào `+N files`. Bấm chip để mở **Sources** bên phải: các dòng được trích sáng lên, kèm một dòng
  mỗi bên, và có nút **Open in Code**. `Esc` quay về thread.
- **Giờ**: rê chuột lên một tin để thấy giờ trong ngày (`14:32`); rê lên giờ để xem ngày và tin đến vào lúc nào tính
  từ đầu council. Tin của bạn không có dòng tên phía trên; câu trả lời của chuyên gia chỉ ghi lập trường khi họ có một
  (**has doubts**, **is against it**, **builds on it**).
- **Sent, Seen, đang gõ**: như ứng dụng nhắn tin, tin mới nhất của bạn ghi **Sent**, khoảng một giây sau thành **Seen**
  kèm avatar nhỏ của các ghế đang trả lời nó, rồi mỗi ghế hiện một bong bóng ba chấm cho tới khi câu trả lời đến.
- Rời đi chỗ khác rồi quay lại, council mở đúng chỗ bạn đang đọc.

Phím, khi focus đang ở trong kênh hay thread (không phải trong ô nhập): `j` / `k` chuyển giữa các ý, `Enter` mở thread
của ý đang chọn, `Esc` đóng thread, và khi không có thread mở thì `Esc` thoát council về terminal.

![Discussion của council "Rail apps" ở vòng 2: hàng ghế lọc trên cùng (Everyone, UX, RAM, New user, Skeptic, Coordinator), các ý trong bong bóng màu kèm chip file và cảnh báo "Weak", câu trả lời vòng 2 bên dưới, thread của một ý mở ở panel phải, ô nhắn ở đáy](images/council-discussion.png)

## Nhắn cho council

Ô nhắn dưới kênh (và ô trả lời trong một thread) dùng được cả khi council đang chạy lẫn khi đã xong:

- `Enter` gửi, `Shift+Enter` xuống dòng. Gõ `@` để nhắm tới một ghế (`↑` / `↓` chọn, `Enter` hoặc `Tab` lấy), hoặc để
  thêm một chat đang sống.
- **Ảnh và file**: dán hoặc kéo thả ảnh vào, ảnh nằm chờ thành thumbnail trên dòng chữ; gõ `@` rồi vài chữ của tên một
  file trong project để đính kèm file đó. Các ghế trả lời sẽ đọc thứ bạn đính kèm.
- **Let them read files**: bật thì các chuyên gia được đọc code khi trả lời. Một câu hỏi tiếp theo có nhắc tên file hay
  đường dẫn sẽ tự bật công tắc này và cho biết nó thấy file nào; câu không nhắc file nào thì trả lời từ chính cuộc thảo
  luận, rẻ hơn khoảng năm lần. Bạn vẫn tự gạt được công tắc.
- **Gợi ý trả lời**: trong một thread, câu trả lời mới nhất của chuyên gia đề xuất hai ba câu bạn có thể gửi tiếp,
  thành chip ngay trên ô trả lời khi ô còn trống; bấm một chip là câu đó vào ô để bạn sửa rồi gửi.
- Câu hỏi gửi cho nhiều chuyên gia thì một người trả lời trước; những người sau đọc câu đó và chỉ thêm phần góc nhìn của
  họ mang lại, hoặc chỉ hiện là "agrees" dưới câu trả lời đó.
- Người trả lời câu hỏi tiếp theo cũng thấy báo cáo, nên bạn viết "hướng 2" là họ hiểu đó là hướng thứ hai trong báo cáo.

## Báo cáo

Khi council xong, nó mở ở báo cáo: một câu trả lời trước, rồi các hướng đi. Một **ma trận** cho biết mỗi chuyên gia đứng ở
đâu (**Agrees**, **Has doubts**, **Is against it**); các ý được xếp hạng theo ba lựa chọn hàng đầu của từng chuyên gia.

- **Cột thông tin** bên cạnh, luôn hiện khi cuộn: trạng thái và chi phí, mục lục của báo cáo (bấm để nhảy tới; phần đang
  đọc có màu xám), từng chuyên gia với model của họ và những gì họ đã làm, và tài liệu đã lưu. Bấm một chuyên gia để
  Discussion chỉ hiện ý và câu trả lời của người đó; **Show everyone** hiện lại tất cả.
- **Ask next**: báo cáo kết thúc bằng hai ba câu đáng hỏi tiếp (chỗ các chuyên gia vẫn còn bất đồng, một điều kiện chưa ai
  kiểm, một góc nhìn còn thiếu). Chúng là các chip dưới tin mới nhất và dưới **Ask next**; bấm một chip là câu hỏi vào ô
  nhắn, có sẵn `@` tới chuyên gia nó dành cho, để bạn sửa rồi gửi.
- **Was this useful?** với **Useful** và **Not really**; đổi được về sau.
- **Tài liệu đã lưu**: mỗi council xong được lưu trong project thành `docs/council/<ngày>-<tính năng>.md`, gồm cả cuộc
  thảo luận. Báo cáo hiện đường dẫn và mở được file.

![Báo cáo của council: dải "Outdated · 1 reply since" với Summarize again, câu bạn hỏi, câu trả lời in đậm, các hướng đi đánh số kèm chip lập trường của từng chuyên gia, một hướng mở ra lý lẽ của từng người; cột thông tin bên phải với mục lục và các chuyên gia](images/council-report.png)

## Khi một lượt gọi bị lỗi

- **Retry** trên ghế lỗi chạy lại lượt đó; **Retry with…** chọn model khác cho riêng lượt đó (opus, Opus 4.8, sonnet,
  fable, haiku) mà ghế vẫn giữ model của nó; tài liệu đã lưu ghi lại lần retry này.
- Lượt gọi bị bộ lọc an toàn của Claude chặn sẽ tự chạy lại một lần trên Opus 4.8, như chính Claude Code vẫn làm.
- Từ hai ghế lỗi trở lên, dải ghế có **Retry all**: chọn model bên cạnh mỗi ghế lỗi (mặc định là model của chính nó), rồi
  tất cả chạy lại cùng lúc.
- Panel **Summary failed** có nút đóng; nó chỉ hiện lại khi bản tổng kết lỗi lần nữa.

## Ghim, xóa

- **Pin** ở đầu Discussion và trên thanh tab của báo cáo **ghim** council, ở bất kỳ trạng thái nào, kể cả đang chạy: nút
  đổi thành **Pinned**, và council nằm trên cùng trong project của nó ở cây Agent. Bấm **Pinned** để bỏ ghim. Hover một
  hàng council trong cây (hay chuột phải) cũng có **Pin**, hay **Unpin** trên council đã ghim. Chỉ bạn ghim và bỏ ghim:
  Retry, Summarize again hay một câu trả lời mới không đụng tới.
- Cây chỉ giữ những council đang chạy, đang chờ bạn hay đang xếp hàng; council đã ghim; council kết thúc chưa tới một
  ngày; và council đã kết thúc mà bạn chưa mở. Một council đã kết thúc, không ghim, quá một ngày thì tự rời cây; bỏ ghim
  một council như thế là nó rời cây ngay.
- **Councils** ở đầu sidebar liệt kê mọi council: hàng được ghim có dấu ghim, và mỗi hàng có **Pin** / **Unpin** khi
  hover hay chuột phải. Đây là chỗ tìm lại một council đã rời cây.
- **Remove council…** trong menu chuột phải xóa hẳn: file của council vào `~/.arc/trash`, còn tài liệu nó đã viết vẫn
  giữ nguyên. Council đang chạy hay đang chờ bạn phải dừng trước.
- Chuột phải → **Copy id** lấy id để dùng với `wsh council show|wait|stop|rm`.

## Council ở những chỗ khác

- **Cây Agent**: một council trông như một nhóm chat trong danh sách chat: hai ghế thành hai hình tròn chồng nhau (chấm
  xanh khi có ghế đang viết, chấm đỏ khi có lượt lỗi), tiêu đề, và bên dưới là trạng thái cùng thời gian từ tin cuối.
- **Jarvis → Councils** (dưới Runs): mọi council còn đang chạy ở mọi project, cùng các council đã kết thúc trong tuần,
  cái đang chờ bạn lên đầu. Bấm một hàng để mở council, mở thẳng báo cáo khi đã có.
- **Overview của project → History**: council được đặt tên như trong cây; bấm để mở ngay tại chỗ (câu hỏi, câu trả lời,
  các hướng đầu), **Open council** để tới council.
- Council kết thúc thì có toast và chấm chưa đọc trên hàng của nó; council chờ bạn có một mục trong **Needs you**.

## `wsh council` cho agent và cho bạn

| Lệnh | Làm gì |
|---|---|
| `wsh council start "<câu hỏi>"` | Mở một council (qua thẻ Token burn trước; bị từ chối thì được lưu là not run, rồi **Start council** trong app chạy nó). `--model sonnet` cho mọi chuyên gia, `--model skeptic=opus` cho một ghế; `--agent <tab id>` / `--agent self` xếp ghế cho chat |
| `wsh council estimate` | In nhóm, model của từng chuyên gia và chi phí, không mở gì |
| `wsh council list` | Các council của project, mới nhất trước |
| `wsh council show <id>` / `wait <id>` | In Summary và Matrix dạng markdown; `wait` chờ council dừng rồi mới in |
| `wsh council retry <id>` | Chạy lại một lượt lỗi; `--expert <seat>`, `--model <model>`, `--all` cho mọi ghế lỗi |
| `wsh council stop <id>` | Dừng council đang chạy hay đang xếp hàng |
| `wsh council pin <id>` / `pin --off` | Ghim / bỏ ghim một council, ở bất kỳ trạng thái nào |
| `wsh council rm <id>` | Xóa hẳn một council đã kết thúc |
| `wsh council bench` | Chạy bộ benchmark của council (hỏi Token burn trước); `bench results`, `bench stop` |
