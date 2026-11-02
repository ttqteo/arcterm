# Tính năng dễ quên

Danh sách những tính năng hay trong arcterm mà nếu không ai nhắc thì dễ quên, gom theo tình huống bạn hay gặp và cập
nhật tới **0.15.20** (2026-11-02). Mỗi dòng ghi cách mở và link tới trang hướng dẫn đầy đủ. Muốn biết từng bản đổi gì
thì bấm số phiên bản ở góc dưới bên phải (**What's new**), nút **Try it** trên mỗi ghi chú đưa bạn tới tính năng đó.

> Phím viết theo Windows; trên macOS `Ctrl` thành `Cmd` (trừ `Ctrl+Tab`).

## Khi cần nhiều góc nhìn

- **Council**: hỏi một nhóm agent chuyên gia, họ đưa ý, cãi nhau, rồi xếp hạng các hướng. `Ctrl+N` → **Council**.
  Chọn nhiều agent trong cây (`Ctrl`+click) → chuột phải → **Discuss together** để mở council với chính các chat đó.
  → [Council](council.md)
- **Kéo một chat đang chạy vào council đã có**: gõ `@` trong ô nhắn của council → **Add a live chat**.
  → [Council → Ghế ngồi](council.md#ghế-ngồi)
- **Đính kèm ảnh và file cho council**: dán ảnh, hoặc `@` + tên file. → [Council → Nhắn cho council](council.md#nhắn-cho-council)
- **Ask next**: báo cáo của council gợi ý hai ba câu đáng hỏi tiếp; bấm chip là câu hỏi vào ô nhắn.
- **Retry with…**: một lượt council lỗi thì chạy lại trên model khác; **Retry all** khi có nhiều ghế lỗi.

## Khi thiết kế một tính năng

- **Brainstorm mode**: bảo agent "brainstorm X", rồi `b` hoặc `Ctrl+Shift+B` để xem câu hỏi, bản thiết kế và mockup cạnh
  terminal; cuối cùng là **Check with a builder** rồi **Approve**. → [Brainstorm](brainstorm.md)
- **Mockup trên canvas thay cho ASCII**: agent vẽ mỗi phương án UI thành một board. Mọi canvas đã vẽ nằm trong **Canvas
  gallery** (`Ctrl+G` `v`); mở một canvas ở đó có **Resume** về đúng phiên đã vẽ nó. → [Agent → Canvas](agent.md#canvas)
- **Outline**: nút liệt kê các heading của tài liệu trong Spec / Plan review và trong Preview Markdown / LaTeX của Code.

## Khi làm việc với agent

- **Mở lại agent vừa đóng**: `Ctrl+Shift+T`, như mở lại tab trình duyệt. Hội thoại quay lại ở trạng thái ngủ, chưa tốn
  token cho tới khi bạn đánh thức nó. Giữ 5 agent đóng gần nhất.
- **Ctrl+Tab**: bộ chuyển tab giữa các agent và terminal, cái dùng gần nhất lên trước; nhấn nhanh thì quay về tab trước.
- **`Alt`+`1`…`9`**: nhảy tới hàng thứ n của cây; giữ `Alt` một lúc để thấy số trên từng hàng.
- **Đọc lại cả cuộc trò chuyện cạnh terminal**: `Ctrl+Shift+F` mở tab **Transcript** trên rail; nút **Compactions** đi
  ngược qua từng lần compact để đọc lại những gì đã bị cắt khỏi terminal.
- **Đọc một phiên cũ mà không resume**: trong hộp New, **Transcript** trên một phiên (`Shift+Enter`), không tốn token.
- **Ô Task của hộp New**: gõ `@` để chèn đường dẫn file của project; dán hay kéo ảnh vào; `Alt`+`1`…`9` đổi agent mà
  không rời ô; `Enter` để khởi chạy.
- **Mark for later**: chuột phải một phiên → đánh dấu để quay lại; phiên đó đứng đầu danh sách của project cho tới khi
  bạn chọn **Done**.
- **Copy id**: chuột phải một agent → **Copy id**, dán vào tin nhắn để nói với agent này về agent kia. Kéo một agent thả
  lên pane của agent Claude, giữ `Alt`, thì token `@` của nó được gõ sẵn vào prompt.
- **Agent ngủ**: agent rảnh 30 phút thì ngủ để trả RAM, **Wake** hoặc một tin nhắn đánh thức nó. Agent có context lớn được
  compact khi cache còn nóng, nên lần đánh thức sau rẻ hơn. → [Settings → Agents](settings.md#agents)
- **Overview của project**: bấm tên một thư mục project trong cây để mở **Overview** của project (đang chờ
  gì, đang chạy gì, History có tìm kiếm `/`, thẻ Branches, lịch hoạt động cả năm). Chuột phải thư mục → **New agent…**
  mở hộp New với project đó đã chọn sẵn.
- **Kéo file từ Explorer/Finder** thả lên cây Files của rail để copy vào thư mục dưới con trỏ.
- **Copy bảng**: rê chuột lên một bảng trong Preview hay trong câu trả lời của agent → nút copy; dán vào Sheets, Excel,
  Notion thành bảng thật.

## Khi xem code và thay đổi

- **Ai viết dòng này**: trong Code, nút **Blame** hoặc `b` mở cột commit bên cạnh editor; dòng do một run land thì ghi
  goal của run đó. → [Code](code.md#ai-viết-dòng-này)
- **Diff trong Code** (`d`): từ `HEAD`, sang base của branch (mọi thứ branch này đã đổi trong file), rồi tắt.
- **Ghim file**: chuột phải → **Pin**. File được ghim nằm đầu cây Files và đầu kết quả tìm file, cả trên rail của agent.
- **Đánh dấu đã review** trong Diff: `v` đánh dấu file đang mở rồi sang file chưa review kế tiếp, kèm thanh *n/m
  reviewed*. → [Diff](diff.md)
- **Commit, Fetch, Pull, Push ngay trong Diff**: chỉ commit những file đã tick, nên những gì phiên khác đã stage vẫn
  nguyên.
- **Ảnh trước/sau** trong Diff → Review: PNG, JPG, GIF, WebP hiện hai bên kèm kích thước.
- **Tab Changes trên rail của agent**: toàn bộ file đã đổi, công tắc Session / Branch, commit ngay tại đó.

## Khi theo dõi và điều phối

- **What's waiting**: `Ctrl+J` từ bất cứ đâu, kể cả trong terminal. → [Jarvis](jarvis.md)
- **Office**: `o` trên Cockpit để xem agent như một sơ đồ văn phòng; `n` dẫn tới việc Needs you kế tiếp, `m` mở menu.
  → [Cockpit → Văn phòng](cockpit.md#văn-phòng-office)
- **Jarvis → Councils**: mọi council đang chạy và các council xong trong tuần.
- **Hàng đợi run**: `wsh runs start --plan <file> --queue` (hoặc `--after <run>`) để run tự bắt đầu khi có chỗ.
  → [Orchestrator](orchestrator.md)
- **Hàng đợi lệnh nặng**: build, typecheck, cả bộ test của mọi agent xếp hàng theo RAM; chip **Jobs** trên app bar có
  **Run now** và **Skip**. → [Usage → Hàng đợi lệnh nặng](usage.md#hàng-đợi-lệnh-nặng)
- **Đóng nhiều agent một lúc**: panel Consumers, tick các hàng (hoặc **Sleeping**) rồi **Close**.
- **Menu bar / khay hệ thống**: xem RAM, CPU, ổ đĩa, giải phóng, chạy hay bỏ qua job đang chờ, mà không phải đưa cửa sổ
  lên.
- **Trả lời agent từ Telegram**: ghép một bot trong Settings → General → Notifications.
  → [Settings](settings.md#trả-lời-câu-hỏi-của-agent-từ-telegram)

## Công cụ nhỏ nhưng hay dùng

- **Translate**: `Ctrl+Shift+D` từ bất cứ đâu. Vừa copy một từ thì chip **Paste** hiện dưới ô, `Tab` để dịch luôn; ô
  trống thì liệt kê lịch sử, ☆ để lưu từ cần học, nút loa đọc to.
- **Note**: `Ctrl+Shift+N` thu cửa sổ thành ô nổi với một ghi chú markdown tự lưu. `Shift+F` để float terminal đang chọn.
- **Notes trong Search**: `Ctrl+P`, gõ `no:` để liệt kê, xem, copy, sửa ghi chú; agent ghi chú bằng `wsh note add`.
- **Open a tool**: `Ctrl+Shift+O` mở lazygit, yazi, btop… ngay trong thư mục của agent đang focus.
  → [Agent → Tools](agent.md#tools)
- **App ghim trên nav rail**: cho một tool có **Page** trong Setup → Tools, arcterm tự cấp cổng, khởi động, khởi động lại
  khi nó sập, và tắt sau một phút bạn không dùng. Ghim tối đa ba app lên rail.
- **Fold vào Sprout**: `Ctrl+M` thu cửa sổ vào con vật; chuột phải nút Sprout → **Fold to** để chọn góc.
- **Ghim Jarvis đứng yên**: từ panel của nó, hoặc Settings → Jarvis, trong một giờ, bốn giờ hay cho tới khi bạn thả.

## Khi dọn dẹp và tiết kiệm

- **Settings → Storage**: worktree của run đã xong, phiên Claude cũ, log, build output; dọn từng loại bằng một nút.
- **Setup → Memory**: mỗi tuần kiểm memory của Claude Code trong từng project và đề xuất xóa, gộp, hay chuyển; hoàn tác
  được trong 30 ngày. **Setup → Project** cho thấy mọi thứ định hình Claude trong một project.
- **Usage → Insights**: xếp các thay đổi theo lượng quota chúng tiết kiệm được (context dài, đọc file quá lớn, output Bash
  ồn, Opus cho việc rõ ràng). → [Usage](usage.md)
- **Tài khoản Claude riêng cho một project**: Settings → Agents → Claude account → **+ Project account**.
  → [Settings](settings.md#đổi-tài-khoản-claude-hoặc-thêm-một-tài-khoản)
- **Bảng phím**: nút **?** ở thanh dưới mở bảng phím tắt của surface đang xem, kể cả khi bạn đang gõ trong terminal.
