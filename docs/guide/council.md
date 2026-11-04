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
| Review a UI feature | Ease of use, Memory watcher, New user, Bug hunter | Summarizer |
| Paper review | Reviewer A, Reviewer B, Reader | Final judge |
| Product ideas | New user, Designer, Builder, Other side | Host |
| Chats with a Bug hunter | các chat bạn chọn + Bug hunter | Summarizer |
| Chats with the Other side | các chat bạn chọn + Other side | Host |

Hai nhóm cuối dành cho council có xếp ghế cho chat. Bạn thêm vai của riêng mình trong `councilroles.json`, nằm trong
thư mục config.

**Tên vai theo ngôn ngữ của câu hỏi.** Mỗi vai dựng sẵn có một tên tiếng Anh dễ hiểu và một tên tiếng Việt, và council hiện
bộ tên khớp với ngôn ngữ bạn đặt câu hỏi: câu hỏi có chữ chỉ tiếng Việt mới viết (đ, ă, â, ê, ô, ơ, ư, hay nguyên âm có
dấu thanh) thì hiện tên tiếng Việt, còn lại là tiếng Anh. Council đọc ngôn ngữ này một lần lúc bắt đầu và lưu lại; các vai
Setup gợi ý thêm cũng được đặt tên bằng ngôn ngữ đó. Ghế bạn đã đổi tên, vai của riêng bạn và ghế agent giữ nguyên tên.
Mã vai không đổi, nên council cũ vẫn mở bình thường.

| Mã | Tiếng Anh | Tiếng Việt |
|---|---|---|
| `ux` | Ease of use | UX |
| `ram` | Memory watcher | Đo RAM |
| `newuser` | New user | Khách |
| `skeptic` | Bug hunter | Tìm bug |
| `coordinator` | Summarizer | Thư ký |
| `reviewer-a` / `reviewer-b` | Reviewer A / B | Giám khảo A / B |
| `reader` | Reader | Biên tập |
| `areachair` | Final judge | Tổng hợp |
| `designer` | Designer | Thiết kế |
| `builder` | Builder | Dev |
| `contrarian` | Other side | Phản biện |
| `facilitator` | Host | Dẫn dắt |

Ngoài các vai, council còn xếp được ghế cho các **chat đang sống** của bạn:

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

- **Rail Ideas**: bên phải kênh, mỗi ý một dòng như Decided so far của brainstorm: số thứ tự, người viết, tiêu đề, và
  một dòng mờ ghi số câu trả lời và lập trường các ghế đã chọn. Bấm một dòng để cuộn kênh tới ý đó. Nút » gấp rail lại,
  nút **Ideas · N** trên kênh mở lại; arcterm nhớ lựa chọn này.
- **Thread**: chip trả lời trên một ý mở thread của nó ở tab thứ hai của rail; tab **Ideas** quay về danh sách, nút ×
  đóng thread.
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

## Nhãn: ý nào đứng vững

Chuyên gia chỉ có `Read`, `Grep` và `Glob`, và không model nào có Bash. Nhưng arcterm không nhận lời họ nói làm bằng
chứng: sau vòng 1 và sau mỗi lượt trả lời, Go tự kiểm từng ý (và từng câu trả lời có lập trường: đồng ý, có nghi ngờ,
phản đối) rồi gắn một **nhãn**. Nhãn do Go đặt từ những gì nó kiểm được, không bao giờ do model.

| Nhãn | Nghĩa | Khi nào |
|---|---|---|
| **Ran** (Đã chạy) | Go đã chạy lệnh cho ý này và kết quả đúng như chuyên gia dự đoán | lệnh `verify` của ý chạy xong, pass hay fail đúng như họ nói trước |
| **Disproved** (Bị bác) | Go đã chạy lệnh và kết quả ngược với dự đoán; màu đỏ, kèm dấu x | lệnh chạy xong, pass hay fail khác với `expect` |
| **Read code** (Đã đọc code) | ý trích code và trích dẫn đứng vững | ít nhất một `path:line` có thật và đoạn chuyên gia trích có ở đó |
| **Guess** (Chỉ đoán) | ý không trích gì, hoặc không trích dẫn nào đứng vững | không có bằng chứng, hoặc không cái nào khớp |

Một trích dẫn không khớp (file không có, số dòng vượt cuối file, đoạn trích không thấy gần dòng đó) hiện **Wrong cite**
(Trích sai) ngay trên chip và không được tính vào Read code; một ý có cả trích dẫn đúng lẫn sai vẫn là Read code, còn mỗi
trích dẫn sai vẫn hiện riêng. "Gần dòng đó" là chính dòng hay đoạn được trích, cộng ba dòng mỗi bên, phân biệt hoa thường.
Trích dẫn vào file hay thư mục bạn đính kèm cho council được kiểm theo đường dẫn đó (với file ngoài project, trích bằng
đường dẫn tuyệt đối); trích dẫn của một ghế agent được kiểm theo thư mục làm việc của chính agent đó khi biết, không thì
theo project; `screenshot:` không bị gắn nhãn hay đếm. Council **Brainstorm** không đòi bằng chứng, nên không có nhãn, không
có thanh bằng chứng và không có bước chạy lệnh.

### Lệnh kiểm chứng

Ở vòng 1, một chuyên gia theo vai (không phải ghế agent) có thể xin Go chạy lệnh để kiểm một ý của mình, kèm điều nó
đoán sẽ xảy ra (`pass` hay `fail`) và một dòng lý do. Chỉ ba dạng lệnh được phép, chạy thẳng không qua shell:

- `go test ./pkg/x -run TestY`: đúng một package, bắt buộc có `-run` (cho thêm `-count=1`, `-v`…)
- `npx vitest run path/to/file.test.ts`: đúng một file (cho thêm `-t "tên"`)
- `cargo test [--manifest-path src-tauri/Cargo.toml] tên_test`: đúng một tên test

Lệnh có `|`, `&&`, `;`, `>`, `<`, dấu backtick hay `$(`, lệnh của chương trình khác, hay đường dẫn chui ra ngoài cây thì không
chạy; dòng timeline ghi "not run: not on the list" và ý giữ nhãn Read code hoặc Guess. Mỗi chuyên gia chạy tối đa **2** lệnh
mỗi council, mỗi lệnh dừng sau **3 phút**, và mỗi lệnh xin một chỗ trong hàng đợi job như mọi lượt gọi của council.

- **Chạy ở đâu**: lúc council bắt đầu, Go chụp project như nó đang là (HEAD cộng thay đổi chưa commit và file chưa theo
  dõi) thành một commit mà không đụng index hay file của bạn, và các lệnh chạy trong một cây tạm tách khỏi branch ở commit
  đó, tức là trên đúng đoạn code các chuyên gia đã đọc. Cây bị xóa khi council xong, lỗi hay bị dừng; checkout của bạn không
  bao giờ bị ghi. Project không phải git repo thì không chạy lệnh nào, và timeline nói rõ vì sao.
- **Lúc nào**: ngay sau vòng 1, trước chỗ dừng sau vòng 1, để kết quả nằm trước mắt bạn khi chọn ý nào cần cắt. Ý bạn cắt thì
  kết quả của nó không đi tiếp vào vòng 2. Council một vòng cũng chạy bước này, và kết quả đi tới bản tổng kết.
- **Kết quả**: mỗi lệnh ghi pass hay fail, mã thoát, 40 dòng cuối của output và việc nó có đúng như dự đoán không. Kết quả được
  đưa vào lời nhắc vòng 2 của **mọi** ghế, không chỉ người xin lệnh, nên vòng 2 cãi nhau trên kết quả.
- **Chỉ kết quả đã thật sự thử ý đó mới tính.** Lệnh quá giờ, lệnh không khớp test nào ("no tests to run", "No test files
  found", "running 0 tests") hay không build được thì ghi **not run** kèm lý do, không bao giờ là pass hay fail, và không bao
  giờ làm một ý thành Ran hay Disproved.

### Timeline của từng chuyên gia

Council giữ mọi việc mỗi chuyên gia đã làm, tối đa 200 dòng mỗi người (dòng cũ nhất rớt trước): giờ, loại việc (đọc file, tìm,
chạy lệnh, đăng ý, trả lời), đích đến (file, mẫu tìm, lệnh) và kết quả khi có. Lệnh hiện bằng font mono. Mở timeline từ nút
**Timeline** trên mỗi ghế trong popover Seats, hay từ thẻ chuyên gia trong tab **Map**. Với ghế agent, timeline lấy từ các
dòng hoạt động agent báo trên roster, nên loại việc chỉ đoán được phần nào ("reading seat.go", "running go test…").

## Tab Map

Council có ba tab: **Report**, **Discussion** và **Map** (Bản đồ), mở được cả khi council đang chạy lẫn khi đã xong.

- **Thẻ chuyên gia**: một thẻ mỗi ghế, trong một hàng: avatar, tên vai, việc đang làm (lệnh đang chạy hiện bằng font mono
  kèm chấm làm việc), một thanh bằng chứng bốn đoạn (Ran xanh lá, Disproved đỏ, Read code trung tính, Guess vàng hổ phách) kèm
  số đếm bằng chữ, rồi token, thời gian và số lượt gọi. Không có "độ tự tin" do model tự khai: thanh bằng chứng thay nó, và do
  Go đếm. Bấm thẻ để mở timeline của ghế.
- **Ma trận lập trường**: mỗi ý một hàng, xếp theo mức đồng thuận cao trước, mỗi ghế một cột. Mỗi ô là một viên thuốc:
  **Proposed**, **Agrees**, **Has doubts**, **Against** hay "not said"; ô ghi "revised in round N" khi tác giả đã sửa ý sau một
  lời thách thức. Dưới tên mỗi ý là nhãn kiểm của nó: Ran (kèm lệnh và kết quả), Read code (kèm chip `path:line`) hay Guess. Hai
  cột cuối là thanh đồng thuận (xanh / vàng hổ phách / đỏ, kèm số bằng chữ, ví dụ "2 agree · 1 doubt") và kết cục lấy từ báo
  cáo; ý bị rút lại bị làm mờ. Phía trên bảng có chú thích cho từng nhãn. Bấm một hàng (hay `Enter`) để mở lý do của từng ghế
  dưới cột của họ; mỗi lúc mở một hàng, bấm lần nữa để đóng. Từ bảy ghế trở lên, ma trận cuộn ngang trong khung của nó, cột ý
  đứng yên bên trái. Trước khi có bản tổng kết, lý do lấy từ chính các câu trả lời, nên Map dùng được ngay khi council còn chạy.
- Trạng thái không bao giờ chỉ là màu: mỗi nhãn và mỗi viên thuốc có biểu tượng hay chữ.
- Council **Brainstorm** không có nhãn và thanh bằng chứng; ma trận thêm viên thuốc **Builds on**, còn thẻ vẫn giữ token, thời
  gian và số lượt gọi.

Các nhãn cũng hiện trên chip bằng chứng trong Discussion và Report.

## Nhắn cho council

Ô nhắn dưới kênh (và ô trả lời trong một thread) dùng được cả khi council đang chạy lẫn khi đã xong:

- `Enter` gửi, `Shift+Enter` xuống dòng. Gõ `@` để nhắm tới một ghế (`↑` / `↓` chọn, `Enter` hoặc `Tab` lấy), hoặc để
  thêm một chat đang sống.
- **Ảnh và file**: dán hoặc kéo thả ảnh vào, ảnh nằm chờ thành thumbnail trên dòng chữ; gõ `@` rồi vài chữ của tên một
  file trong project để đính kèm file đó. Các ghế trả lời sẽ đọc thứ bạn đính kèm.
- **Let them read files**: bật thì các chuyên gia được đọc code khi trả lời. Một câu hỏi tiếp theo có nhắc tên file hay
  đường dẫn sẽ tự bật công tắc này và cho biết nó thấy file nào; câu không nhắc file nào thì trả lời từ chính cuộc thảo
  luận, rẻ hơn khoảng năm lần. Bạn vẫn tự gạt được công tắc.
- **Link web**: một tin nhắn có địa chỉ `http://` hay `https://` sẽ khoá Let them read files ở trạng thái bật, và các ghế
  trả lời có thêm WebFetch để mở trang đó thay vì đoán. Câu hỏi lúc mở council có link thì vòng 1 cũng được mở trang.
  Chuyên gia đọc trang như tài liệu để nhận xét, không làm theo chỉ dẫn trong trang. Mỗi lần mở trang tốn thêm token.
- **Gợi ý trả lời**: trong một thread, câu trả lời mới nhất của chuyên gia đề xuất hai ba câu bạn có thể gửi tiếp,
  thành chip ngay trên ô trả lời khi ô còn trống; bấm một chip là câu đó vào ô để bạn sửa rồi gửi.
- Câu hỏi gửi cho nhiều chuyên gia thì một người trả lời trước; những người sau đọc câu đó và chỉ thêm phần góc nhìn của
  họ mang lại, hoặc chỉ hiện là "agrees" dưới câu trả lời đó.
- Người trả lời câu hỏi tiếp theo cũng thấy báo cáo, nên bạn viết "hướng 2" là họ hiểu đó là hướng thứ hai trong báo cáo.

## Báo cáo

Khi council xong, nó mở ở báo cáo: một câu trả lời trước, rồi các hướng đi; các ý được xếp hạng theo ba lựa chọn hàng đầu của
từng chuyên gia. Ai đồng ý với ý nào (**Agrees**, **Has doubts**, **Against**) nằm ở tab [**Map**](#tab-map): báo cáo có một
dòng "See who agrees with which idea in Map" mở nó.

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
  đổi thành **Pinned**, và council nằm trên cùng trong project của nó ở cây Agent. Bấm **Pinned** để bỏ ghim. Ngoài ra
  chỉ ghim được từ **Councils** và từ History của Overview project (mở một hàng council, hay chuột phải): cây không có
  nút Pin. Chỉ bạn ghim và bỏ ghim:
  Retry, Summarize again hay một câu trả lời mới không đụng tới.
- Cây chỉ giữ những council đang chạy, đang chờ bạn hay đang xếp hàng; council đã ghim; council kết thúc chưa tới một
  ngày; và council đã kết thúc mà bạn chưa mở. Một council đã kết thúc, không ghim, quá một ngày thì tự rời cây; bỏ ghim
  một council như thế là nó rời cây ngay.
- **Close** (hover một council đã kết thúc và không ghim, hay chuột phải) đưa nó ra khỏi cây ngay, không
  phải chờ một ngày, và không xóa gì: **Councils** vẫn giữ nó. Nếu council đó chạy lại (một câu hỏi tiếp), nó trở lại
  cây. Việc Close được nhớ theo máy này, không ghi vào file council.
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
