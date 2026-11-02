# Brainstorm

Khi bạn nhờ một agent brainstorm một tính năng, arcterm không để cuộc brainstorm trôi trong scrollback của terminal nữa mà
hiện nó thành một **pane** cạnh terminal của agent. Pane gồm câu hỏi đang chờ bạn, bản thiết kế đang thành hình qua từng
câu trả lời, các mockup đặt cạnh phần mà chúng minh họa, và cuối cùng là một lượt kiểm của builder rồi mới bắt đầu run.
Cách này dùng được cho brainstorm ở bất kỳ project nào.

Đừng nhầm với chế độ **Brainstorm** của [Council](council.md#hai-chế-độ): bên đó là một nhóm chuyên gia cùng đưa ý, còn ở
đây là bạn và một agent cùng chốt một thiết kế.

## Bắt đầu

Bảo một agent Claude hay pi "brainstorm tính năng X" (hoặc dùng `superpowers:brainstorming`). Agent dùng skill
`arc:brainstorm`, lưu trạng thái vào `.superpowers/brainstorm/<chủ đề>/brainstorm.json`, và header của agent hiện công tắc
**Terminal | Brainstorm | Review** ở chỗ của Canvas.

- `b` (khi focus không ở trong terminal) hoặc `Ctrl+Shift+B` (cả trong terminal): chuyển giữa terminal và brainstorm.
- `Alt+C`: lần lượt Terminal → Brainstorm → Review.
- Lần đầu mở, một thẻ trên đầu pane (**How to use a brainstorm**) chỉ cách dùng; ✕ ẩn nó đi luôn. Footer liệt kê phím của
  pane khi pane đang mở.

Trong cây Agent, agent đang chờ bạn trả lời brainstorm nhấp nháy như một câu hỏi, và ghi "confirm N decisions" khi thiết
kế đang chờ bạn xác nhận các phỏng đoán của agent.

## Trả lời từng câu hỏi

Mỗi lần pane chỉ hỏi một câu. Phía trên các đáp án ghi rõ bạn chọn một (**Pick one**) hay chọn được nhiều.

- `a` / `b` / `c` / `d` đặt focus vào đáp án đó, `Enter` gửi. Bấm một hàng là gửi luôn hàng đó.
- Khi các đáp án kết hợp được, mỗi hàng có ô tick: tick vài ô rồi **Send** để gửi chúng cùng lúc.
- Lúc nào cũng trả lời tự do được bằng lời của bạn (**Or type your own answer…**), `Enter` gửi, `Shift+Enter` xuống dòng.
- Câu trả lời trước đó ghi rõ nó đã vào phần nào của thiết kế.

**Judge cho câu hỏi chọn hướng.** Khi câu hỏi là chọn giữa các hướng tiếp cận, một judge độc lập (không biết agent nghiêng
về đâu) cân từng hướng. Mỗi hướng có chữ cái của nó, nút **N facts** để xem các dữ kiện (**Show all facts** mở hết), và
**Show pros and cons**. Hàng ghi **Judge's pick** và **Agent's pick** để bạn thấy hai bên có đồng ý không; hướng bị loại
nằm dưới **Dropped by the judge**. Nút xem dữ kiện tách khỏi hàng, nên đọc dữ kiện không vô tình chọn đáp án.

## Bản thiết kế

Bản thiết kế (**The design**) lớn dần theo cuộc trò chuyện. Mỗi phần được đánh dấu:

| Dấu | Nghĩa |
|---|---|
| **Yours** | Bạn đã nói hoặc đã xác nhận |
| **Agent's call** | Agent tự quyết, chờ bạn xác nhận |
| Đang được hỏi | Phần mà câu hỏi hiện tại đang hỏi |
| Còn mở | Chưa ai quyết |
| **Changed since you confirmed it** | Agent đổi một phần bạn đã xác nhận; nó quay lại thành phỏng đoán, kèm cái gì đổi và vì sao |

Phần cuối luôn là **Left to the builder**, những gì để lại cho người xây. Brainstorm vẫn còn nguyên sau khi compact, khi
khởi động lại arcterm, và cả khi agent đã thoát (**Resume in a new agent**). Agent đã ngủ thì pane vẫn hiện brainstorm;
**Wake** đánh thức agent, và trả lời ngay trong pane cũng đánh thức nó kèm câu trả lời của bạn.

## Mockup trong rail bên phải

Khi các phương án khác nhau về UI, agent vẽ mỗi phương án thành một board riêng (Option A, Option B…) chứ không vẽ ASCII.
Các board nằm trong một **rail co giãn được** bên phải câu hỏi:

- Kéo rail rộng ra thì các board nằm cạnh nhau, mỗi board có tiêu đề là phương án của nó và sáng lên cùng phương án khi
  bạn rê chuột vào một trong hai.
- Bấm một board (hay thumbnail của nó) để mở lớn trong rail mà câu hỏi vẫn ở trên màn hình; vẽ đánh dấu (marking) trên đó
  được. `[` / `]` hoặc `←` / `→` chuyển board, `Esc` thu lại.
- Sau khi bạn chọn, các board bị bỏ qua được dời vào thư mục `unchosen/`, nên run chỉ xây đúng phương án bạn chọn.

## Builder check và Approve

Khi thiết kế đã đủ, **Check with a builder** cho một reviewer mới (chạy trên route reviewer của run) đọc bản spec như
người sẽ xây nó. Trong lúc đó pane ghi "A builder is reading the design." Kết quả hiện thành **Review what the check
changed**:

- `j` / `k` đi qua từng quyết định, `Enter` xem nó trước đó là gì.
- `y` (**Keep the change**) giữ thay đổi; với một phỏng đoán thì `y` là xác nhận nó. `u` (**Put mine back**) trả lại bản
  của bạn.
- Khi đã trả lời xong, hàng Builder check và Judge gấp thành một chip nhỏ có dấu cho mỗi lượt kiểm; bấm để mở lại.

**Approve and start run** mở New run với bản thiết kế đính kèm. Nút này tắt khi run đang khởi động ("The run is starting"),
để bạn không lỡ bắt đầu cùng một run hai lần. Run hiện trong History bằng tên tính năng ("Build …"). Agent đã brainstorm
ngủ 15 giây sau khi ghi nhận run để trả RAM (trừ khi **Sleep idle agents** tắt). Khi run đã merge, **Close the
brainstorm** kết thúc luôn agent đó (trừ khi nó còn đang làm) và giữ canvas thiết kế trong Canvas gallery.

## Xem thêm

- [Orchestrator](orchestrator.md): run mà Approve khởi động.
- [Agent → Canvas](agent.md#canvas): canvas thiết kế và Canvas gallery.
- [Phím tắt → Agent: brainstorm mode](../keyboard-shortcuts.md#agent-brainstorm-mode).
