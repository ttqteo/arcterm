# Section For later trong Jarvis

Brainstorm: `.superpowers/brainstorm/jarvis-later/brainstorm.json` (2026-11-13).

## Ý định

Một chỗ trong Jarvis liệt kê mọi phiên mang dấu "Mark for later", để quay lại hoặc bấm Done mà không phải lục từng
project. Hôm nay có 22 dấu trên 6 project, cũ nhất từ 2026-10-12, và không màn hình nào cho thấy đủ chúng.

## Hiện có gì

- Dấu later lưu trên workspace, meta `session:later`: map từ session id (stem của file transcript) sang thời điểm
  đánh dấu, Unix ms (`frontend/app/view/agents/latermodel.ts`, `laterstore.ts`). `laterMarksAtom` đọc nó;
  `setLater(transcriptPath, on)` ghi lại cả map.
- Đặt và xoá dấu qua menu dòng: "Mark for later" / "Done (clear later)" trong cây Agent (`agenttree.tsx`,
  `laterMenuItem`) và Conversation History (`projecthistory.tsx`, `sessionMenu`). Chỉ hai chỗ này đọc dấu; History đẩy
  phiên later lên đầu (`laterFirst`).
- Mở transcript: `showSession(model, key)` (`agentcenter.ts`). Resume hoặc đi tới agent đang sống:
  `runSessionPrimary(model, s)` (`sessionsdetail`), dựa trên `LiveSession` (`task`, `transcriptpath`,
  `resumecommand`, `live`, `liveId`).
- Danh sách phiên đã kết thúc đến từ archive phân trang (`sessionsarchivestore.ts`); History chỉ đọc đủ trang để phủ
  7 ngày (`HISTORY_WINDOW_MS`).
- Jarvis là Brief (`frontend/app/view/jarvis/briefsurface.tsx`): cột chính có Waiting và Initiatives; cột phụ có
  Activity, Since you looked, Shipped, Ideas. Brief có quy tắc: region trống thì viết một câu, không để khung rỗng;
  số đếm in ra bằng số dòng hiện, phần bị ẩn ghi "+N more". Undo cho hành động trong Brief: `briefundo.ts`.

## Thiết kế

### Vai trò

For later là danh sách thụ động. Nó không đếm vào badge Jarvis trên nav rail và không nhắc khi dấu đã cũ. Dấu chỉ
mất khi người dùng bấm Done (ở đây hoặc ở menu dòng như hiện nay).

### Vị trí

Một region "For later" ở cột phụ của Brief, sau Ideas. Hiện 5 dòng đầu; phần còn lại sau "+N more" mở tại chỗ, như
Shipped. Không có dấu nào thì region viết một câu (vd "Nothing marked for later.") thay vì để trống.

### Thứ tự

Một danh sách phẳng, không nhóm, xếp theo thời điểm đánh dấu, mới nhất trước.

### Một dòng

- Hiện: tên phiên (`task`, hoặc "(untitled session)"), project, và tuổi của dấu ("3d").
- Bấm dòng: phiên còn sống thì chọn agent đó trên Agent; phiên đã kết thúc thì mở transcript (`showSession`), không
  khởi động agent nào.
- Nút Resume trên dòng, chỉ với phiên đã kết thúc có `resumecommand`: làm tiếp như `runSessionPrimary`.
- Nút Done: `setLater(transcriptPath, false)`, qua cơ chế undo của Brief như các hành động khác.

### Phiên không tìm thấy

Tên và project lấy từ cùng nguồn phiên mà History dùng, tra theo session id của dấu, không giới hạn 7 ngày của History:
một dấu 30 ngày tuổi vẫn phải hiện tên của nó. Một dấu không tìm thấy phiên nào vẫn được hiện, ghi
"(session not found)", không có nút Resume và không mở được, để người dùng vẫn bấm Done được.

- **Agent's call:** Done xoá dấu theo session id (qua `withLater` trên id, một hàm mới trong `laterstore.ts`), không
  qua `setLater(transcriptPath)`, vì một dấu không tìm thấy phiên thì không có transcript path.
- **Agent's call:** Done dùng commit hoãn của hàng undo trong `briefundo.ts`: dấu chỉ bị xoá khi hết thời gian undo,
  nên Undo không đánh dấu lại phiên với thời điểm mới; dòng ẩn ngay khi bấm.
- **Agent's call:** Trong lúc tra cứu chưa xong, dòng hiện id ngắn của phiên ở dạng mờ, không hiện "(session not
  found)"; chữ đó chỉ hiện khi tra cứu đã xong mà không có kết quả.

### Phiên còn sống

Phiên đang sống mang dấu vẫn được liệt kê, cùng thứ tự với phiên đã kết thúc.

## Để lại cho builder

- Cách tra một session id ra `LiveSession` khi phiên nằm ngoài các trang archive đã tải: dùng RPC có sẵn nếu có, nếu
  không thì thêm một tra cứu theo id ở wavesrv.
- Region tham gia thứ tự con trỏ bàn phím của Brief (`useSurfaceListNav`), sau Ideas.
- Logic thuần (gộp dấu với phiên, sắp xếp, cắt 5 dòng, nhãn tuổi) trong một file `.ts` có `.test.ts` cạnh bên; view
  mỏng.
- Một scenario CDP trong `scripts/cdp/scenarios.mjs` mở Jarvis với vài dấu fixture (một phiên đã kết thúc, một phiên
  sống, một dấu không tìm thấy phiên, và trạng thái rỗng) và chụp region.
- Một dòng `Added` trong `CHANGELOG.md`.

## Ngoài phạm vi

- Nhắc dấu cũ, đếm vào badge, nhóm theo project.
- Đổi cách đánh dấu: menu dòng hiện có giữ nguyên.
