# Chọn board nhanh trong Chat

Ngày: 2026-11-16 · Brainstorm: `.superpowers/brainstorm/canvas-quick-pick/brainstorm.json`

## Mục đích

Có những lúc agent vẽ vài phương án (board) trong Canvas rồi hỏi "Bạn chọn A, B hay C?". Lúc đó Chat cần một thẻ để chọn
nhanh, giống thẻ câu hỏi của brainstorm và các chip của initiatives. Hiện nay một phiên thường chỉ có chip do model đoán
("A đi", "B đi", tối đa 3).

## Hiện có gì (bối cảnh)

- Thẻ câu hỏi của brainstorm trong Chat: `chatbrainstormcard.tsx:82`. Các dòng A/B/C là `OptionRows`
  (`chatbrainstormparts.tsx:473`), bấm một dòng là gửi label của nó. Link "Compare N boards" ở
  `chatbrainstormcard.tsx:163`. Vỏ thẻ dùng chung là `CardShell` (`chatbrainstormparts.tsx`).
- Chip dưới ô chat lấy từ `chatChips` (`chatsuggest.ts:210`), tối đa `MAX_CHIPS = 3` (`chatsuggest.ts:61`); hàng chip
  được dựng ở `chatpane.tsx:789-800`. `endsWithQuestion` (`chatsuggest.ts:84`) nhận ra một câu trả lời kết thúc bằng
  câu hỏi.
- Canvas của agent: `canvasStateAtom(agent.id)` (`canvasstore.ts:34`), trong đó `boards: CanvasBoard[]` đọc từ
  `canvas.json` (`canvaspoller.ts:46`). `CanvasBoard = { name, x, y, w, h, title? }` (`canvasmodel.ts:20`). Header dùng
  atom này để hiện tab Canvas và chấm xanh (`agentheader.tsx:441`, `:942`); tab chỉ hiện khi agent không có brainstorm.
- Quy ước board phương án (`skills/design/SKILL.md:65-82`): `A-<slug>.dc.html`, `B-<slug>.dc.html`…, title
  `Option A: <là gì>`, theo đúng thứ tự trong `order` của `canvas.json`. Bạn chọn xong thì agent dời các board không được
  chọn sang `unchosen/` và xoá chúng khỏi `canvas.json`.
- Gửi một dòng cho agent: `sendToAgent(blockId, text)` (`agentsubmit.ts:108`). Thêm `\r` ở cuối thì dòng được gửi luôn.

## Thiết kế

### Hình dạng

Khi Canvas của agent có các board phương án, cuối Chat hiện một thẻ: mỗi board một dòng A/B/C mang tiêu đề board, bấm
một dòng là chọn; kèm link mở Canvas để so sánh. Agent không phải viết gì thêm, thẻ dựng hoàn toàn từ các board.

### Khi nào thẻ hiện

Thẻ chỉ hiện khi đủ cả bốn điều kiện sau:

- Agent đã dừng lượt và đang chờ bạn.
- Câu trả lời cuối của agent kết thúc bằng câu hỏi (`endsWithQuestion`).
- Có từ 2 board phương án mà câu trả lời cuối nêu chữ cái thành dòng phương án (`A — …`, `**A** …`, `- A: …`). Board
  của câu hỏi trước còn trong canvas nhưng không được nhắc thì không hiện. Hai board trùng chữ cái thì lấy board sửa gần
  nhất.
- Agent không có brainstorm đang mở, vì thẻ brainstorm đã làm việc này.
- Agent đang được focus, và canvas là canvas agent đã mở trong phiên app này (`wsh ui reveal canvas:<topic>` →
  `attachCanvas`, `openref.ts:600`). Chỉ khi đó `canvasStateAtom(agent.id)` mới có và được poller cập nhật. Ô split
  không focus, hay sau khi khởi động lại app, sẽ không có thẻ; chip vẫn như cũ. Không đổi poller.

Khi thẻ hiện, chip model đoán ("A đi") ẩn đi. Thẻ tự tắt khi agent dời các board không được chọn khỏi `canvas.json`,
hoặc khi agent bắt đầu một lượt mới.

### Bấm một dòng thì gửi gì

Bấm là gửi ngay nhãn kèm tiêu đề board, ví dụ `A — Gộp các lần liên tiếp cùng file`, như thẻ brainstorm gửi label của
dòng. Muốn kèm ghi chú thì gõ vào ô chat.

### Thẻ trông thế nào

- Dùng lại `CardShell` và `OptionRows` của thẻ brainstorm.
- Đầu thẻ là câu hỏi cuối của agent, tức câu kết thúc bằng dấu hỏi.
- Mỗi dòng có chữ cái và tiêu đề board, cùng một nút nhỏ mở đúng board đó trong Canvas.
- Chân thẻ có "Compare N boards in Canvas" (mở tab Canvas) và "Type below to answer in your own words". Chữ trên thẻ
  bằng tiếng Anh như thẻ brainstorm; nhãn gửi đi giữ tiêu đề board như agent viết. (Agent's call)
- Gửi xong, thẻ biến mất. Dòng đã gửi (`A — …`) ở lại trong Chat như một tin nhắn của bạn, nên không có dòng ✓ riêng và
  không phải lưu gì thêm. (Agent's call)

## Để lại cho người làm

- **Nhận diện board phương án:** tên board khớp `^[A-Z]-.+\.dc\.html$`, và chữ cái đó được câu trả lời cuối nêu thành
  một dòng phương án (dòng hoặc gạch đầu dòng mở đầu bằng chữ cái, có thể in đậm, theo sau là `—`, `-`, `:`, `.` hoặc
  `)`). Lấy theo thứ tự trong `canvas.json`. Hai board trùng chữ cái thì lấy board có `lastModified` mới nhất mà poller
  đã đọc. Nhãn là chữ cái đầu tên. Tiêu đề là `title` của board bỏ tiền tố `Option X: `; board không có title thì dùng slug.
- **Model thuần:** đặt logic trong `chatcanvaspick.ts`, gồm việc nhận diện board, điều kiện hiện thẻ và dòng gửi đi,
  kèm `chatcanvaspick.test.ts` bằng vitest. Component `.tsx` chỉ là lớp mỏng bên trên (theo quy ước frontend trong
  AGENTS.md).
- **Gửi:** dùng `sendToAgent` (`agentsubmit.ts:108`), không dùng `sendBrainstorm`, vì hàm đó gắn với tệp brainstorm.
- **Kiểm tra trên app:** một scenario CDP trong `scripts/cdp/scenarios.mjs` dựng một agent đang chờ, câu trả lời cuối
  kết thúc bằng câu hỏi, cùng một canvas có các board `A-…` và `B-…`. Scenario chụp thẻ, bấm một dòng, rồi kiểm tra dòng
  gửi đi và việc thẻ biến mất.
- **CHANGELOG:** thêm một dòng `Added`.
