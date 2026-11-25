# Pair một agent với judge

Bạn làm việc với một agent, và muốn một agent khác đọc thẳng code rồi chấm công việc đó. Thay vì tự dán câu trả lời của
bên này sang bên kia, bạn **ghép đôi** (pair) hai agent: một **working agent** làm việc và một **judge** đánh giá. Mỗi
câu trả lời của bên này tự chuyển sang bên kia; bạn đọc cuộc trò chuyện của hai agent và chỉ xen vào ở chỗ quyết định
thuộc về bạn.

Đừng nhầm với [Council](council.md): council là cả một nhóm chuyên gia, ba vòng, vài triệu token, kết thúc bằng một báo
cáo. Pair chỉ có hai agent nói chuyện trực tiếp, không có agent trung gian nào chọn câu gì được chuyển hay ai được nói.

Pair dùng được với agent Claude và pi. Một agent nằm trong nhiều nhất một pair đang chạy, ở bên nào cũng vậy.

## Bắt đầu một pair

**Cách chính: nút Add judge trong header của working agent.** Dùng khi bạn đọc đến một tin nhắn muốn có người chấm.
Menu của nút có:

- **Open a new judge**: mở một tab Claude mới (chạy **Opus**) trong cùng project, ở thư mục của working agent (worktree
  của nó nếu có, để judge đọc đúng code đang sửa). Judge nhận brief gồm plan hay spec đang dùng, câu trả lời mới nhất của
  working agent, và dặn "đọc code thật trước khi kết luận".
- Hoặc một agent Claude hay pi đang chạy trong project mà chưa nằm trong pair nào; agent đó nhận brief làm prompt đầu tiên.

Khi pair đã thành, header có nút **Pair** ngay cạnh Chat / Terminal, kèm số tin mới (từ lần cuối bạn mở cuộc trò
chuyện). Pair là nút bật tắt: bấm thì cột giữa thành cuộc trò chuyện của pair và nút sáng lên, bấm lại (hoặc Chat,
Terminal, Esc) thì về đúng view lúc trước. Bên cạnh có nút **+** để thêm judge thứ hai, thứ ba. Dòng trạng thái của agent
ghi "waiting on judge" khi judge còn nợ một câu trả lời. Header của judge cũng có nút Pair (không đếm tin mới) mở cùng
cuộc trò chuyện đó, và ở chỗ dấu + là một icon link sang agent mà nó đang chấm.

Trong cây Agent, một pair là **một dòng** ở chỗ của working agent: bấm vào thì mở cuộc trò chuyện. Mặc định dòng đó gập
lại, dòng phụ ghi trạng thái từng bên ("worker working · judge idle"), RAM và token là của cả pair. Mũi tên bên trái mở
ra working agent và các judge bên dưới; khi một agent trong pair đang hỏi bạn, hay đang được chọn, nó tự mở ra.

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
- Lệnh nặng bị giữ hiện thành một dòng nét đứt trong tin của working agent, kèm **Run now** (xem [Giữ lệnh nặng](#giữ-lệnh-nặng-và-run-now)).

Khi pair đang bật, **mọi lượt** của working agent đều chuyển sang judge, kể cả lượt bạn bắt đầu ngay trong Chat của agent.
Muốn làm việc với agent mà không có judge thì **Unpair**.

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
- **Token cap**: tổng Input + CacheRead + CacheCreation + Output của mọi session trong pair từ lúc ghép đôi (mặc định
  3M, đổi được trong sheet), kiểm sau mỗi lượt kết thúc của một thành viên.
- **Judges gone**: không còn judge nào sống.

Khi dừng, pair ghi một dòng hệ thống ("Paused: the judge has no new points", "Paused: both agree", "Paused: token cap
reached (3.0M)"), thôi chuyển tin và giữ hàng đợi. Pair vẫn ghép: nó **tạm dừng**, không kết thúc. Trả lời của judge
đứng sau một lần dừng "no new points" hay "both agree" không được chuyển cho working agent, vì chúng không đòi gì ở nó;
chuyển đi sẽ mở một lượt làm cuộc trao đổi chạy lại.

**Chạy tiếp:** tin của bạn chạy tiếp mọi kiểu dừng. Một câu trả lời mới của working agent chạy tiếp mọi kiểu dừng
**trừ token cap**: sau mức trần, một câu trả lời của working agent sẽ vượt trần ngay lập tức, và tiêu thêm là quyết định
của bạn. Chạy tiếp sau token cap thì mức trần tính lại từ lúc đó.

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

## Pair sống ở đâu

Mỗi pair là một tệp JSON, `<thư mục dữ liệu của wave>/pairs/<id>.json`, nên nó sống qua lần khởi động lại arcterm: khi
wavesrv khởi động, arcterm nạp các pair đang chạy, nhận câu trả lời mà một thành viên đã đưa ra trong lúc nó tắt, và thử
giao lại hàng đợi, nên lệnh nặng vẫn được giữ và không có prompt nào bị kẹt.

## Xem thêm

- [Council](council.md): cả một nhóm chuyên gia thay vì hai agent.
- [Agent](agent.md): header, rail và cây của agent.
- [Usage → Hàng đợi lệnh nặng](usage.md#hàng-đợi-lệnh-nặng): luật phân loại lệnh nặng mà pair dùng để quyết định lệnh nào bị giữ.
- `docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md`: bản thiết kế và lý do của từng quyết định.
