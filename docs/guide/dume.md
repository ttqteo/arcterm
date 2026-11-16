# DUM-E

**DUM-E** dùng nốt phần quota của cửa sổ 5 giờ sắp reset mà bạn không đụng tới. Bạn giao cho nó vài chunk của
[initiative](jarvis.md); trong giờ cuối của cửa sổ, nếu quota còn nhiều, sonnet làm từng chunk một, mỗi chunk trên một
branch riêng. DUM-E chỉ commit trên branch đó: nó không merge, không push, không land. Land branch và đánh dấu chunk
xong là việc của bạn.

DUM-E **tắt mặc định**. Bật nó ở **Settings → Runs & limits**, thẻ **DUM-E**, công tắc **Spend the leftover 5h window
on chores** (khóa `dume:enabled`, xem [Settings](settings.md)).

## Giao một chunk cho DUM-E

```bash
wsh effort chunk owner <effort> <chunk> dum-e
```

DUM-E chỉ nhận chunk thỏa cả ba điều kiện: owner là `dum-e`, trạng thái `pending`, và initiative của nó **active** và
có một project đã đăng ký với đường dẫn. Initiative không có project, hay project chưa có đường dẫn, thì chunk của nó
đứng yên chờ, DUM-E không đụng tới. Hàng đợi đi theo thứ tự initiative rồi thứ tự chunk, và mỗi lúc chỉ có một run của
DUM-E.

Đề bài của run gồm tên initiative, tên chunk và mọi ghi chú trên chunk, nên hãy viết chunk như viết cho một agent chưa
biết gì. Nếu chunk cần một quyết định chỉ bạn đưa được, run viết câu hỏi thành ghi chú của chunk rồi dừng mà không
commit: chunk đó thành `blocked` (xem bên dưới).

## Khi nào DUM-E bắt đầu

DUM-E mở một cửa sổ 5 giờ chỉ khi **tất cả** điều kiện sau cùng đúng, kiểm tra mỗi 5 phút:

| Điều kiện | Ngưỡng |
|---|---|
| Còn bao lâu tới lúc cửa sổ 5 giờ reset | Từ 60 phút trở xuống |
| Cửa sổ 5 giờ còn lại | Từ 30 % trở lên (đã dùng không quá 70 %) |
| Cửa sổ tuần | Đã dùng ít hơn mức chi đều ít nhất 10 điểm phần trăm |
| Run của chính bạn | Không có run nào đang chạy |
| Bộ nhớ máy | Memory pressure không ở mức warn hay critical |

**Mức chi đều** là phần trăm của tuần đã trôi qua: tuần reset sau 3,5 ngày thì mức chi đều là 50 %, nên DUM-E chỉ bắt
đầu khi tuần đã dùng không quá 40 %. Quota 5 giờ còn dư vẫn tính vào tuần, vì vậy kiểm tra này chặn DUM-E khi bạn đã
chi nhanh hơn tuần cho phép.

Tài khoản không có số đo tuần chung cho mọi model (ghế Team) thì DUM-E đọc cửa sổ tuần của từng model và lấy cái đã dùng
nhiều nhất. Không có số đo tuần nào cả thì DUM-E không bắt đầu, và lý do ghi `no weekly reading`.

## Khi nào DUM-E dừng

Khi đã bắt đầu một cửa sổ, DUM-E tiếp tục lấy chunk kế tiếp cho tới khi cửa sổ 5 giờ **đã dùng 90 %** hoặc **còn không
quá 10 phút** tới lúc reset. Mỗi chunk mới vẫn phải qua kiểm tra tuần, run của bạn và memory pressure; ngưỡng 60 phút và
30 % chỉ áp cho lần bắt đầu đầu tiên của cửa sổ. Khi bạn mở một run của riêng mình giữa chừng, DUM-E không lấy chunk mới
nữa (run đang chạy của nó vẫn chạy nốt) cho tới khi run của bạn xong.

## Một chunk đi qua những bước nào

Mỗi chunk là một run **Quick** chạy `claude` với model `sonnet`, trong một worktree mới trên branch
`wave/dume-<8 ký tự đầu của initiative>-<thời điểm>`, tạo từ HEAD hiện tại của project. Trạng thái của chunk nằm ngay
trong **ghi chú** của nó (mở chunk trong initiative để đọc), nên không có chỗ nào khác để theo dõi:

| Ghi chú mới nhất của DUM-E | Trạng thái chunk | Nghĩa là |
|---|---|---|
| `DUM-E: started run <id> on <branch>` | `active` | Run đang chạy trên branch đó. |
| `DUM-E: ready to land <branch> (N commits): git merge <branch>` | `active` | Run xong và có commit. Dòng `git merge` là lệnh bạn chạy trong project để land. |
| `DUM-E: nothing committed on <branch>; set the chunk back to pending to try again` | `blocked` | Run xong mà không commit gì (có khi nó để lại một câu hỏi trong ghi chú của chunk). Tree và branch đã bị dọn. Đặt chunk về `pending` để DUM-E thử lại. |
| `DUM-E: could not start: <lỗi>` | `blocked` | Không dựng được tree hay không khởi chạy được run. Sửa nguyên nhân rồi đặt chunk về `pending`. |

Đặt lại chunk để thử lại:

```bash
wsh effort chunk status <effort> <chunk> pending
```

## Land và đóng chunk

DUM-E không bao giờ đánh dấu một chunk là `done`: chunk chỉ xong khi bạn làm hai việc.

1. Xem branch (`git log`, hay mở [Diff](diff.md)) rồi land nó, ví dụ chạy lệnh `git merge` trong ghi chú của chunk.
2. Đánh dấu chunk xong: `wsh effort chunk status <effort> <chunk> done`.

Mỗi lần thử có commit để lại một branch `wave/dume-…` trong project. arcterm không xóa nó, vì chunk đang chờ bạn land
trên đó: sau khi land, tự xóa bằng `git branch -d <branch>`.

## Xem DUM-E đang làm gì

```bash
wsh dume status          # thêm --json để lấy dữ liệu thô
```

In ra DUM-E đang bật hay tắt, lần kiểm tra gần nhất và **lý do** của nó (`working`, `2h10 to the 5h reset; starts
within 1h00`, `week 45% used at 38% pace; needs 10 points under`, `1 of your runs live`, `memory pressure high`, `no
chunk owned by dum-e waiting`…), số đo cửa sổ 5 giờ, chunk đang chạy, số chunk đang chờ, đang chờ land, bị chặn và đã
xong, và mỗi chunk chờ land kèm lệnh `git merge` của nó.

Cùng thông tin đó hiện thành một dòng trên header của [Brief](jarvis.md#brief), sau dòng tình hình các agent, khi
công tắc đang bật: `DUM-E · <lý do hay working: tên chunk> · N to land`. Dòng dài thì bị cắt; rê chuột lên để đọc đủ.
