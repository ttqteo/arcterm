# Pair một agent với judge

Bạn làm việc với một agent, và muốn một agent khác đọc thẳng code rồi chấm công việc đó. Thay vì tự dán câu trả lời của
bên này sang bên kia, bạn **ghép đôi** (pair) hai agent: một **working agent** làm việc và một **judge** đánh giá. Mỗi
câu trả lời của bên này tự chuyển sang bên kia; bạn đọc cuộc trò chuyện của hai agent và chỉ xen vào ở chỗ quyết định
thuộc về bạn.

Đừng nhầm với [Council](council.md): council là cả một nhóm chuyên gia, ba vòng, vài triệu token, kết thúc bằng một báo
cáo. Pair chỉ có hai agent nói chuyện trực tiếp, không có agent trung gian nào chọn câu gì được chuyển hay ai được nói.

Pair dùng được với agent Claude và pi. Một agent nằm trong nhiều nhất một pair đang chạy, ở bên nào cũng vậy.

## Bắt đầu một pair

**Cách chính: nút ⚖ Judge this reply dưới một câu trả lời của working agent, ngay trong Chat.** Nút nằm trong hàng nút dưới
câu trả lời (cùng hàng với Copy và Fork), hiện khi rê chuột hay focus, kể cả ở câu trả lời mới nhất. Dùng khi bạn đọc đến
một câu trả lời muốn có người chấm, **kể cả câu cũ hơn**: judge chấm đúng câu bạn bấm, không phải câu mới nhất. Chỉ câu
đã xong mới có nút, và chỉ ở câu cuối của mỗi lượt (đoạn chữ giữa hai lần gọi tool trong cùng lượt thì không), trong Chat
của một agent Claude hay pi đang chạy. Với Claude, câu nào của session hiện tại cũng có nút; với pi chỉ câu mới nhất có
(pi không lưu id của từng câu). Header của agent chưa ghép không còn nút Add judge. Khi agent đang nằm trong một pair
chưa kết thúc, ⚖ dưới mọi câu bị mờ và không làm gì (chú thích ghi rằng một vòng judge đang chạy: Unpair hoặc chờ vòng
kết thúc); muốn thêm judge thì dùng nút **+** ở header.
Menu của ⚖ mở ngay tại nút và có:

- **Wake <tên>**, mục đầu và chỉ có khi working agent này có một judge đang nghỉ từ vòng trước (xem [Judge nghỉ giữa các
  vòng](#judge-nghỉ-giữa-các-vòng)): đánh thức judge đó và ghép một pair mới với nó. Judge giữ những gì nó đã đọc ở các
  vòng trước; nó nhận brief mới làm prompt đầu tiên.
- **Open a new judge**: mở một tab Claude mới (chạy **Opus**) trong cùng project, ở thư mục của working agent (worktree
  của nó nếu có, để judge đọc đúng code đang sửa). Judge nhận brief gồm plan hay spec đang dùng, câu trả lời mới nhất của
  working agent, và dặn "đọc code thật trước khi kết luận".
- Hoặc một agent Claude hay pi đang chạy trong project mà chưa nằm trong pair nào; agent đó nhận brief làm prompt đầu tiên.

**Chấm một câu cũ hơn.** Tin đầu của pair là chính câu bạn bấm (với giờ của nó), và judge nợ một câu trả lời cho tin đó.
Brief của judge dán câu đó vào, kèm đường dẫn transcript của working agent, id bản ghi của câu, và một câu dặn: agent đã
làm tiếp sau câu này; nếu cần cho nhận xét thì đọc những gì nó làm sau đó trong transcript, và chấm code như nó đang là
bây giờ. Không dán các lượt ở giữa và không tóm tắt chúng. Lời nhắn đầu tiên arcterm gửi cho working agent, sau phần
brief của nó, nói thêm rằng judge đang chấm câu trả lời của nó từ HH:MM, và nên cân nhận xét của judge với những gì nó đã
làm từ đó. Các lượt nằm giữa câu được chọn và lúc ghép đôi **không** được chuyển và không vào cuộc trò chuyện của pair;
việc chuyển tin bắt đầu từ lượt kế tiếp của working agent. Bấm ⚖ dưới câu mới nhất thì y như trước đây: brief không có
đoạn transcript và working agent không nhận thêm câu nào. Không tìm thấy bản ghi của câu (transcript đã đổi) thì
arcterm báo lỗi "Couldn't add a judge to <tên>", không lặng lẽ chấm câu mới nhất. Bấm **+** trên header của một pair
đang chạy thì thêm judge vào pair đó, tin đầu của pair không đổi.

Khi pair đã thành, header có nút **Pair** ngay cạnh Chat / Terminal, kèm số tin mới (từ lần cuối bạn mở cuộc trò
chuyện). Pair là nút bật tắt: bấm thì cột giữa thành cuộc trò chuyện của pair và nút sáng lên, bấm lại (hoặc Chat,
Terminal, Esc) thì về đúng view lúc trước. Bên cạnh có nút **+** để thêm judge thứ hai, thứ ba. Dòng trạng thái của agent
ghi "waiting on judge" khi judge còn nợ một câu trả lời; khi pair đang dừng thì nó ghi lý do dừng ("Paused: judge token
cap reached"), không ghi "waiting on judge". Header của judge cũng có nút Pair (không đếm tin mới) mở cùng cuộc trò chuyện
đó, và ở chỗ dấu + là một icon link sang agent mà nó đang chấm.

Trong cây Agent, working agent vẫn là **agent chính** với dòng agent bình thường của nó, như khi chưa có judge. Khi một
vòng đang sống, dòng đó có thêm một dòng nhỏ luôn hiện, không gập: ⚖, trạng thái của judge bằng chữ, số token judge đã
tiêu và số tin mới. Bấm vào dòng ⚖ thì mở cuộc trò chuyện của pair; bấm chỗ khác trên dòng agent thì mở working agent.
Judge không có dòng riêng. Có nhiều judge thì dòng ghi "2 judge" và trạng thái của judge cần bạn nhất (đang hỏi, rồi
đang làm, rồi còn lại). Một pair đang dừng có thêm nút ở cuối dòng ⚖, hiện khi rê chuột hay focus: **Resume** hoặc
**Judge again** (xem [Khi nào pair dừng](#khi-nào-pair-dừng)).

**Dấu của vòng trong Chat.** Trong Chat của working agent, câu mà một vòng judge bắt đầu từ đó có một dòng ⚖ ngay dưới
nó (mảnh, chữ xám nhỏ, không có khung), và các lượt thuộc về vòng có một **thanh 2px** bên trái, kéo từ câu đó xuống
cuối Chat khi vòng còn sống:

- Trong lúc judge chưa trả lời lần đầu: một vòng quay và "The judge is reading this reply · N s" ("Judge đang chấm reply
  này · N s", số giây chạy lên), cuối dòng là **Open pair**, mở cuộc trò chuyện của pair như nút Pair ở header.
- Sau khi judge đã trả lời, vòng còn sống: "⚖ The judge round starts here" ("⚖ Vòng judge bắt đầu ở đây"), vẫn có
  **Open pair**; thanh vẫn màu nhấn.
- Vòng đã kết thúc (cả khi bạn bấm Unpair): dòng thành một nút, "⚖ Judge round 13:40–13:52 · 3 agreed, 0 open" ("⚖ Vòng
  judge 13:40–13:52 · 3 chốt, 0 còn mở"), thanh chuyển **xám** và dừng ở tin cuối của working agent trong pair. Bấm dòng
  đó thì mở trang của pair trong Library.
- Một câu đã bắt đầu hai vòng thì có cả hai dòng, vòng cũ ở trên. Chỗ hai thanh chồng lên nhau chỉ vẽ thanh của vòng mới.
- Chat tìm câu của vòng bằng nội dung tin đầu của pair; tin đó không có trong Chat đã tải (câu của một session trước)
  thì vòng không có dấu, và không có lỗi nào.
- Dòng và thanh bằng tiếng Việt khi bạn viết tiếng Việt, ngược lại bằng tiếng Anh. Dòng mở ra bằng chuyển động lò xo
  và chữ đổi trạng thái mờ dần sang chữ mới; thanh đổi màu từ màu nhấn sang xám khi vòng kết thúc. Bật reduced motion
  thì mọi thứ về thẳng trạng thái cuối.

**Cách thứ hai: cây Agent.** Chọn hai agent (Ctrl hoặc Shift+click), bấm chuột phải, chọn **Pair: worker + judge**, nằm
trên **Discuss together** (mục này vẫn mở Setup của council). Agent chọn đầu tiên là working agent. Một sheet nhỏ hiện ra:

- ai làm, ai chấm, nút **Swap** đổi chỗ hai bên;
- ô "Hold heavy commands until the judge answers" (bật sẵn);
- "Note to the judge (optional)";
- giới hạn token tính bằng triệu (mặc định 3);
- **Pair**.

Không có lệnh `/judge` và không có `wsh pair`.

## Cuộc trò chuyện

Bấm nút Pair (hay dòng của pair trong cây), cột giữa thành cuộc trò chuyện của pair, header của agent vẫn ở trên, và rail
chuyển sang tab Decided. Một dòng mảnh dưới header ghi bạn đang ghép với ai (các judge, hay agent mà judge đang chấm),
trạng thái của bên kia, và nút **Unpair**.

- Đọc như nhắn tin giữa hai người, từ trên xuống theo thời gian: tin của working agent lệch trái, của judge lệch phải.
  Có nhiều judge thì mỗi tin bên phải ghi tên judge của nó.
- Mỗi tin hiện đủ, thành một khối riêng có đầu (ai, mấy giờ). Không có vòng: không có số "round" ở đâu cả.
- Tin trả lời một tin khác trích dòng mà nó trả lời ở đầu tin; bấm vào dòng trích để cuộn tới tin gốc. **Reply** khi rê
  chuột vào một tin là trả lời đúng tin đó.
- Một ô soạn ở cuối nói chuyện với cả hai; gõ `@worker` hay `@judge` để chỉ nói với một bên. Tin của bạn cũng hiện trong
  dòng thời gian, trải hết chiều rộng, đề "You" và ghi gửi cho ai.
- **Tin gửi cho cả hai (không có `@`) thì working agent trả lời trước, rồi judge chấm câu trả lời đó.** Tin của bạn nằm
  sẵn trong hàng đợi của judge làm ngữ cảnh, nhưng judge chưa được gọi: khi working agent trả lời xong, judge nhận tin
  của bạn cùng câu trả lời ấy trong một prompt và chấm câu trả lời, không trả lời bạn song song. `@judge` (hay
  `@<id của judge>`) gọi judge ngay, không chờ working agent. Ô soạn ghi điều này ở chỗ gợi ý: "To both: the worker
  answers, then the judge judges it · @judge to ask the judge now" (bản tiếng Việt khi các tin của bạn trong pair viết
  tiếng Việt).
- Lệnh nặng bị giữ hiện thành một dòng nét đứt trong tin của working agent, kèm **Run now** (xem [Giữ lệnh nặng](#giữ-lệnh-nặng-và-run-now)).

Khi pair đang chuyển tin, **mọi lượt** của working agent đều chuyển sang judge, kể cả lượt bạn bắt đầu ngay trong Chat
của agent. Khi pair đã dừng thì không còn vậy: một lượt mới của working agent mà không trả lời tin nào của pair sẽ kết
thúc vòng (xem [Một vòng kết thúc thế nào](#một-vòng-kết-thúc-thế-nào)). Muốn làm việc với agent mà không có judge ngay
giữa chừng thì **Unpair**.

## Tab Decided

Trong rail của agent (cạnh Overview, Files, Changes) có thêm tab **Decided** khi agent đang được pair, ở bên working agent
hay bên judge. Tab có chấm hổ phách khi **Waits on you** chưa trống. Từ trên xuống:

- **Waits on you**: các mục đang chờ bạn, mỗi mục kèm các nút trả lời. Câu trả lời của bạn (bấm nút hay gõ) đi tới cả
  working agent và judge. Bạn trả lời xong thì tab hiện câu trả lời đó cho đến khối tiếp theo của working agent.
- **Agreed**: các mục đã chốt, đánh số, mỗi mục dẫn tới tin mà nó được chốt.
- **Still open**: các mục còn mở. Mục mà judge mở lại có ghi điều đó; điểm mới (`new:`) của judge hiện ở đây là của judge
  cho đến khối tiếp theo.

Một mục chờ bạn **không** làm cuộc trao đổi dừng: hai agent tiếp tục bàn các mục còn lại.

## Hai khối: `arc-pair` và `arc-judge`

arcterm không đọc văn xuôi để biết hai agent đồng ý hay chưa. Nó đọc hai khối có cú pháp rõ ràng, giống cách Chat đọc
khối `arc-steps`. Brief của mỗi bên nói rõ điều này.

### `arc-pair`: danh sách của working agent

Working agent kết thúc mỗi câu trả lời bằng một fence tên `arc-pair`, mỗi dòng một mục:

````text
```arc-pair
D1 Khóa ngưỡng §16 trước khi pilot đo — chốt ở bước 2
O2 Tách case pilot khỏi test split
A3 Ngưỡng 50% có ổn không? [Ổn | Cao hơn | Thấp hơn]
```
````

- `D<n>` đã chốt (agreed), `O<n>` còn mở (still open), `A<n>` chờ bạn (waits on you).
- Sau nội dung, ` — <ghi chú>` (dấu gạch dài, hoặc ` -- `) thêm dòng thứ hai mà bảng hiện dưới mục.
- Mục `A` có thể kết thúc bằng `[<chip> | <chip>]`, là các nút trả lời.
- Số của một mục là của nó mãi mãi và không bao giờ dùng lại; mỗi lần khối liệt kê **mọi** mục. Số mà working agent bỏ
  đi thì biến mất khỏi tab Decided: khối mới nhất là cả danh sách.
- Dòng không đọc được thì bị bỏ qua. Nếu một câu trả lời có nhiều khối `arc-pair` ở cấp ngoài cùng thì khối cuối cùng tính.

### `arc-judge`: dấu của judge

Judge không viết danh sách riêng. Nó chỉ đánh dấu bằng một fence `arc-judge`:

````text
```arc-judge
reopen D1: ngưỡng chưa khóa trước lúc đo, xem study_pilot.py:412
new: hai prompt không đối xứng ở loop.py:177 và :218
```
````

- `reopen <n>: <vì sao>` (hoặc `reopen D2: …`) đưa mục số đó về **Still open**. Mục ở trạng thái mở cho đến khối tiếp theo
  của working agent: khối viết sau dấu coi như câu trả lời của working agent; judge còn không đồng ý thì mở lại lần nữa.
- `new: <điểm>` báo một điểm mà working agent chưa liệt kê. Nó có mặt để việc dừng "không còn gì mở" không bắn khi judge
  vừa nêu một điểm bằng văn xuôi mà working agent chưa hề thấy trong danh sách.
- `no new points` (không phân biệt hoa thường) nghĩa là judge không còn điểm nào.
- `summary: <vài câu>` là phần tóm tắt cho bạn. Khi viết `no new points`, judge viết dòng này trước, bằng ngôn ngữ của
  bạn, trong cùng fence, trên một dòng riêng; có nhiều dòng `summary:` thì dòng cuối cùng tính. arcterm đặt nó ở đầu thẻ tạm
  dừng (xem [Khi nào pair dừng](#khi-nào-pair-dừng)) và cắt dòng này khỏi nội dung hiển thị, như cắt cả khối.

````text
```arc-judge
summary: Hai bên đã chốt ngưỡng 50% và tách case pilot; còn ba câu hỏi chờ bạn về cỡ mẫu.
no new points
```
````

### Trích dòng được trả lời

Một câu trả lời bắt đầu bằng dòng trích Markdown (`> …`) thì dòng đó thành phần trích hiện ở đầu tin và không còn nằm
trong thân tin. Không có dòng trích thì phần trích là dòng đầu của tin mà nó trả lời. Cả hai khối `arc-pair` và
`arc-judge` đều được cắt khỏi nội dung hiển thị (arcterm giữ nguyên văn bản gốc).

## Khi nào pair dừng

Việc dừng do chính hai agent nói trong tin nhắn của họ, qua các khối trên:

- **Judge không còn điểm mới**: mọi judge còn sống, trong câu trả lời cho tin mới nhất của working agent, đều có
  `no new points` và không có `reopen` hay `new:`. Có nhiều judge thì pair chỉ dừng khi **tất cả** nói vậy.
- **Both agree**: khối mới nhất đi cùng tin mới nhất của working agent không có mục `O`, và câu trả lời của mọi judge cho
  nó có fence `arc-judge` không chứa `reopen` hay `new:`.
- **Token cap**: tổng Input + CacheRead + CacheCreation + Output của session của các **judge** từ lúc ghép đôi (mặc
  định 3M, đổi được trong sheet), kiểm sau mỗi lượt kết thúc của một thành viên. Mức trần chỉ tính token của judge: token
  của working agent vẫn được đọc và hiện ra, nhưng phần lớn là việc nó vẫn làm khi không có judge, nên không tính vào.
  Một judge đã đi (tab bị xóa) vẫn được tính phần nó đã tiêu. Mức trần chỉ là lưới an toàn cho một judge không bao giờ
  hết điểm: vòng thường kết thúc trước, khi judge hết điểm mới hay khi bạn quay lại working agent. Một pair lưu trước
  khi mức trần đổi cách tính giữ con số đã lưu (gồm cả working agent) cho tới lần đếm lại đầu tiên khi nó còn chạy; trang
  Library ghi "judge tokens" cho pair mới và "tokens" cho pair cũ.
- **Judges gone**: không còn judge nào sống.

Khi dừng, pair thôi chuyển tin, giữ hàng đợi và đặt một **thẻ tạm dừng** vào dòng thời gian. Pair vẫn ghép: nó **tạm
dừng**, không kết thúc. Trả lời của judge đứng sau một lần dừng "no new points" hay "both agree" không được chuyển cho
working agent, vì chúng không đòi gì ở nó; chuyển đi sẽ mở một lượt làm cuộc trao đổi chạy lại.

### Thẻ tạm dừng

Thẻ có, từ trên xuống:

- **Đầu thẻ** nói vì sao dừng: "Paused: the judge has no new points", "Paused: both agree", "Paused: judge token cap
  reached (3.0M)" hay "Paused: no judge is left". Đầu thẻ và tên các phần viết bằng tiếng Việt ("Tạm dừng: judge không còn ý
  mới", "Chờ bạn"…) khi các tin của bạn trong pair viết tiếng Việt, còn lại bằng tiếng Anh.
- **Phần tóm tắt** của judge, ở trên cùng, khi judge đã viết dòng `summary:` trong câu trả lời gây ra lần dừng (xem
  [`arc-judge`](#arc-judge-dấu-của-judge)). Dừng ở token cap hay khi không còn judge thì thường không có.
- **Danh sách Decided tại thời điểm dừng**, theo thứ tự: **Waits on you** (mục chờ bạn, kèm các nút trả lời), **Still
  open** (mục còn mở), **Agreed** (mục đã chốt). Phần nào trống thì không hiện. Thẻ giữ một bản chụp, nên thẻ cũ không
  đổi theo danh sách về sau.

Chỉ thẻ mới nhất của một pair đang dừng có nút: các nút trả lời trong **Waits on you** đi qua đường trả lời A-mục như ở
tab Decided, kèm **Resume** hoặc **Judge again** khi có. Thẻ cũ hơn chỉ là chữ. Trang của pair trong Library vẽ cùng thẻ
đó, cũng chỉ là chữ (không có nút trả lời), cộng thêm Resume và Judge again trên đầu trang khi pair đang dừng và nằm ở
máy này.

### Resume và Judge again

- **Resume** ("Chạy tiếp") đưa pair về trạng thái chuyển tin và giao nốt những gì còn trong hàng đợi. Nó **không gửi
  tin nào** và không thêm dòng nào vào dòng thời gian. Có ở ba nơi: trên thẻ tạm dừng, trên dòng ⚖ của pair trong cây
  Agent (hiện khi rê chuột hay focus) và trên trang của pair trong Library. Sau **token cap** nút ghi số token của
  judge mà nó trả lại, "Resume · judge +3.0M" ("Chạy tiếp · judge thêm 3.0M"): mức trần tính lại từ lúc bấm.
- Resume **chỉ hiện khi có gì để giao**, nghĩa là hàng đợi của một bên còn một tin đòi câu trả lời. Trên thực tế đó là
  sau token cap. Sau "no new points" hay "both agree" hàng đợi trống, nên chạy tiếp cũng không ai làm gì: thẻ ghi
  "Message to go on" ("Nhắn để bàn tiếp"), vì một tin của bạn đã chạy tiếp pair rồi. Resume cũng không hiện khi không
  còn judge (thẻ nói rằng **⚖ dưới một câu trả lời** ghép một judge mới), khi pair đã kết thúc, hay khi pair được
  đồng bộ từ máy kia: agent của nó không ở máy này.
- **Judge again** ("Judge tiếp") có ở lần dừng "no new points" và "both agree" của một pair ở máy này (không có khi
  pair đã kết thúc hay được đồng bộ từ máy kia). Nó mở ô soạn của pair với `@judge ` đã gõ sẵn; bạn viết điều judge nên
  nhìn vào rồi gửi, và đường `@judge` gọi judge ngay và chạy tiếp pair. Từ cây Agent hay Library, nút mở cuộc trò
  chuyện của pair trên màn Agent trước, rồi làm như vậy.

**Chạy tiếp:** tin của bạn trong cuộc trò chuyện chạy tiếp mọi kiểu dừng, cũng như Resume và Judge again. Một lượt mới của
working agent thì **không** chạy tiếp pair, ở kiểu dừng nào cũng vậy (token cap cũng thế): nó hoặc là câu trả lời cho một
tin đã gửi (được giữ), hoặc kết thúc vòng. Chạy tiếp sau token cap thì mức trần tính lại từ lúc đó.

## Một vòng kết thúc thế nào

Bạn dùng pair như **một vòng soát** trên working agent: nhờ judge chấm câu trả lời cuối của nó, hai bên qua lại cho tới
khi judge hết điểm mới, rồi bạn quay lại làm tiếp ở chính Chat của working agent. Vòng kết thúc khi bạn quay lại working
agent, không phải khi bạn bấm gì ở pair.

**Khi pair đang dừng** (no new points, both agree, token cap hay judges gone), xét **lượt mới của working agent**:

- Lượt đó **không trả lời tin nào của pair** (một tin bạn gõ trong Chat hay terminal của agent, `wsh agents send`,
  Sidecar, đều tính) thì **vòng kết thúc**. Pair thành `ended` và sang Library với dòng "Round ended: you went back to the
  working agent". Lượt đó không được ghi vào cuộc trò chuyện của pair và không xếp hàng cho judge; judge không được gọi
  nữa. Lệnh nặng đang bị giữ được gỡ như khi Unpair: working agent nhận một dòng nêu tên lệnh và nói nó chạy được ngay.
- Lượt đó là **câu trả lời cho một tin mà judge đã gửi trước khi pair dừng** (ví dụ phần sửa judge vừa gửi, working agent
  đang làm dở) thì **không** kết thúc vòng: nó vẫn được ghi vào cuộc trò chuyện và xếp hàng cho judge, pair vẫn dừng,
  judge đọc nó khi bạn chạy tiếp. Trả lời của judge đứng sau một lần dừng "no new points" hay "both agree" thì chưa bao
  giờ được gửi đi, nên lượt kế tiếp của working agent không phải là câu trả lời cho chúng.
- Một lệnh không tạo câu trả lời nào của working agent (`/compact`, `! cmd`, `/btw`) không kết thúc vòng.

**Khi pair đang chuyển tin**, mọi lượt của working agent vẫn thuộc về vòng như trước: bạn có thể thêm judge ngay lúc
nghi ngờ một câu trả lời, và cuộc qua lại chạy như thường.

Muốn đi tiếp trong vòng thì viết trong cuộc trò chuyện của pair, bấm Resume hay bấm Judge again, trước khi quay lại
working agent.

### Judge nghỉ giữa các vòng

Một judge mà arcterm **mở cho việc này** (tab "Judge: <working agent>" do **Open a new judge** tạo, hay một judge đã được
**Wake**) được cho **ngủ** khi vòng kết thúc: tiến trình dừng, session được giữ, và nó rời cây Agent (nằm ẩn dưới working
agent của nó, miễn là working agent còn trên danh sách). Lần ngủ này không nén (compact) trước, để judge giữ nguyên những
gì nó đã biết cho vòng sau, và chạy dù cài đặt tự ngủ đang tắt, vì nó thuộc về vòng.

- Judge đang bận (đang làm hay đang hỏi bạn) thì vòng vẫn kết thúc ngay, và judge ngủ ở lần nó rảnh kế tiếp. Một judge
  đang hỏi bạn ở lại trong cây cho tới khi bạn trả lời và nó rảnh.
- Judge có việc chạy nền thì không ngủ được: nó ở lại cây như một agent bình thường, và lý do được ghi vào log.
- Một agent bạn **chọn từ danh sách agent đang chạy** làm judge không bị cho ngủ: sau vòng nó về cây như agent bình
  thường, như sau Unpair.
- Nếu có gì đánh thức judge đang ngủ (một tin gửi tới, Sidecar), nó hiện lại như agent bình thường.
- Đóng tab của working agent thì các judge đang ngủ của nó đóng theo, nên không còn judge ẩn nào bị bỏ lại. Nếu tab của
  working agent đã mất, judge ở lại cây như agent bình thường để bạn vẫn với tới nó.
- Khởi động lại arcterm giữa lúc một judge bận thì lần ngủ chờ đó mất; luật tự ngủ khi rảnh lâu lo cho judge ấy.

**Vòng sau:** mục đầu của menu ⚖ (dưới một câu trả lời của working agent đó) là **Wake <tên>**: đánh thức judge đã nghỉ
và ghép một pair mới với nó, từ câu bạn bấm. Pair mới ghi judge ấy là judge do arcterm mở, nên nó lại nghỉ sau vòng này.

## Giữ lệnh nặng và Run now

Khi judge chưa trả lời câu mới nhất của working agent, working agent vẫn đọc, sửa file và chạy lệnh nhẹ. Một **lệnh nặng**
(cùng luật phân loại với [hàng đợi lệnh nặng](usage.md#hàng-đợi-lệnh-nặng): build, test, Docker, lệnh chạy lâu) phải chờ
judge trả lời. Có nhiều judge thì chờ cho
đến khi **tất cả** đã trả lời.

Lệnh nặng mà working agent bắt đầu **giữa một lượt** cũng bị giữ. arcterm từ chối lệnh kèm lý do bảo agent kết thúc lượt và
nói trong câu trả lời nó định chạy lệnh nào. Câu trả lời đó chuyển sang judge như mọi câu khác; judge trả lời xong thì
working agent chạy lệnh ở lượt kế tiếp. Không có tin nào đến judge giữa lượt. Đó là điều chặn trường hợp cũ: agent bắt
đầu một lần thăm dò ngay trong lượt đề xuất nó.

Lệnh bị giữ hiện thành một dòng nét đứt trong tin tiếp theo của working agent, kèm **Run now**. Bấm **Run now** là cho
đúng lệnh đó chạy một lần mà không chờ judge, dòng đổi thành "đã cho qua", và working agent nhận một tin của bạn (hiện
trong dòng thời gian): "Run `<lệnh>` now: the person let it through without waiting for the judge."

Muốn ghép đôi mà không giữ lệnh thì bỏ tick ô "Hold heavy commands until the judge answers" trong sheet của cây Agent
(cách thứ hai ở trên). Việc giữ còn áp dụng suốt thời gian pair đang ghép, cả sau một lần dừng; chỉ Unpair gỡ nó.

## Unpair

**Unpair** (ở thanh trên cùng của cuộc trò chuyện) kết thúc pair và gỡ việc giữ lệnh. Pair rời khỏi danh sách; tệp của nó
vẫn còn với trạng thái `ended`. Một lệnh đang bị giữ mà bạn chưa cho qua sẽ được chạy: working agent nhận một dòng nêu
tên lệnh và nói nó chạy được ngay. Sau Unpair, hai agent là hai agent bình thường; ghép lại thì bắt đầu một pair mới.
Unpair không cho judge ngủ: chỉ việc kết thúc một vòng (quay lại working agent sau khi pair dừng) làm vậy.

## Pair sống ở đâu

Mỗi pair là một tệp JSON, `<thư mục dữ liệu của wave>/pairs/<id>.json`, nên nó sống qua lần khởi động lại arcterm: khi
wavesrv khởi động, arcterm nạp các pair đang chạy, nhận câu trả lời mà một thành viên đã đưa ra trong lúc nó tắt, và thử
giao lại hàng đợi, nên lệnh nặng vẫn được giữ và không có prompt nào bị kẹt.

## Xem thêm

- [Council](council.md): cả một nhóm chuyên gia thay vì hai agent.
- [Agent](agent.md): header, rail và cây của agent.
- [Usage → Hàng đợi lệnh nặng](usage.md#hàng-đợi-lệnh-nặng): luật phân loại lệnh nặng mà pair dùng để quyết định lệnh nào bị giữ.
- `docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md`: bản thiết kế và lý do của từng quyết định.
