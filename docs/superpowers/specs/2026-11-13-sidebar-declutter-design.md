# Gọn lại sidebar Agent: cột số thẳng hàng, 280px cố định

Ngày: 2026-11-13. Brainstorm: `.superpowers/brainstorm/sidebar-declutter/brainstorm.json`.
Prototype: `.superpowers/design/sidebar-declutter/project/A-cot-thang-hang.dc.html`.

## Mục tiêu

Sidebar Agent nhìn rối, nhưng người dùng muốn **giữ đủ mọi thông tin đang hiện**: tên, trạng thái, worker, nguồn run,
tiến độ, RAM, token, tuổi, thanh task. Thông tin nhiều không phải lý do gây rối. Rối là vì cách xếp: mọi thứ cùng độ đậm,
các cột số không thẳng hàng giữa các loại dòng, chip, chữ và số chen nhau. Redesign này chỉ xếp lại thứ bậc, căn hàng
và độ đậm nhạt, không bỏ thông tin nào.

## Hiện nay

- `frontend/app/view/agents/agenttree.tsx` (≈4.100 dòng). Dòng lead của run (`ParentRow` + `RunSubline`, :936): glyph
  và tên trên dòng 1. Dòng 2 gồm `FoldChip` (số worker/task), trạng thái run (`dagProgressLabel`: `queued #N`, `3/5`,
  `merged`…), `OriginFrom` (↰ run gốc), nút Resume khi run tạm dừng, rồi các cột `RAM_COL`, `TOKENS_COL`, `AGE_COL`
  (:2076-2078). Dưới cùng là `TaskStripBar` (:790).
- Dòng conversation (`ConversationRow` / `ConversationHead`, :2044-2066) đặt số ở **dòng tên**, còn agent và lead đặt
  ở dòng 2, nên các cột lệch nhau.
- Ô token/RAM vắng thì biến mất chứ không giữ chỗ (`fields.tokens && tokens`, ≈:1414). Badge unread nằm sau cột tuổi
  (≈:1422), đẩy cả ba cột sang trái.
- Chỉ RAM của lead nhường chỗ dưới 300px (`LEAD_RAM_YIELDS`, :2084), RAM của agent thì không.
- Cây Agent cố định `w-[248px]` (:3820). `agentrailtabs.ts:84` tính `AGENT_TREE_PX = 248` để chia chỗ cho rail. Ở
  248px, ba cột số chiếm khoảng 110px, chỉ còn khoảng 100px cho chữ ở dòng 2.
- Settings → Appearance có nút bật/tắt từng trường của dòng (`rowfields.ts`, lưu ở `agent.row.fields`). Tính năng đó
  giữ nguyên: một trường đã tắt thì cả cột của nó rời khỏi mọi dòng.

## Thiết kế

### Độ rộng

Cây Agent cố định **280px**, không kéo được. Đổi `w-[248px]` ở `agenttree.tsx:3820` và `AGENT_TREE_PX` ở
`agentrailtabs.ts:84` cùng lúc.

### Bố cục dòng

- RAM, token, tuổi luôn nằm ở **ba ô cố định cuối dòng 2** trên agent, lead, run không có lead và **worker**
  (`WorkerRow`). Theo thứ tự RAM · token · tuổi, căn phải, độ rộng tối thiểu như `RAM_COL` / `TOKENS_COL` / `AGE_COL`.
  Tuổi của worker tách khỏi `workerSubtext` để vào cột. Stage/Final, subagent, tác vụ nền, terminal/tool/service và
  các dòng ở mục Conversations giữ nguyên bố cục.
- Ô trống **vẫn giữ chỗ**, ví dụ khi agent chưa có RAM, để cột không lệch.
- Ở 280px cả ba cột luôn hiện. **Bỏ luật nhường cột**, kể cả `LEAD_RAM_YIELDS`.
- Dòng "`10 runs`" trong ảnh là **dòng agent đang sống** mang `OriginChip` (`N runs`), chứ không phải dòng ở mục
  Conversations. Nó theo đúng bố cục của dòng agent. Các dòng ở mục Conversations (`ConversationRow`, `RunConversationRow`:
  phiên hoặc run đã kết thúc, không có RAM) giữ nguyên bố cục. (Agent's call)
- **Badge chưa đọc lên dòng tên**, ở cuối dòng 1, không còn nằm sau cột tuổi. Nó vẫn là **badge đếm số** như hôm nay
  (`unreadLabel`, `data-agent-unread`), không thành chấm, vì phải giữ đủ thông tin. Badge trên dòng terminal, split,
  council và số Jarvis ở thư mục giữ nguyên. (Agent's call)
- **Dòng đang hỏi** (asking/review) giữ ba cột. Chữ hỏi chiếm phần trái của dòng 2, chỗ model/branch/tiến độ vẫn nằm.
- Phần chữ bên trái dòng 2 (model, branch, trạng thái run) co lại và cắt bằng dấu `…`. Không bao giờ đẩy các cột số.
- Các nút và chữ trạng thái trên dòng 2 **giữ ở dòng 2, ngay bên trái ba cột số**, đủ độ rộng, không bao giờ bị cắt:
  Done ✓ (Close), `QueuedJobTag`, `ServerMark`, `in council`, `failed to start`, `ChecksChip`, các `FoldChip`
  (worker, subagent, tác vụ đang chạy), chip ↰ (`OriginFrom` / `OriginChip`), nút Resume và nút `review`. Chỉ phần chữ
  co lại.

### Độ đậm nhạt và ngưỡng

- Mọi số đều **mờ** (`text-ink-faint`).
- **Chỉ ô RAM** đổi sang màu cảnh báo (`text-warning`) khi agent giữ từ **1 GB**, hoặc ở dòng lead khi cả run giữ từ
  1 GB (số mà `useRunRam` trả về).
- Token và tuổi không có ngưỡng. Ngưỡng cố định, không có cài đặt.

### Không đổi

Tên, glyph trạng thái, `FoldChip`, `OriginFrom`, nút Resume, `TaskStripBar`, và các nút bật/tắt trường ở Settings vẫn
như cũ: chỉ đổi chỗ đặt và độ đậm.

## Để builder quyết

- Cách giữ chỗ cho ô trống, ví dụ một span có `min-width` mà không có nội dung.
- Chỗ chính xác của chữ hỏi trên dòng đang hỏi (`ParentRow`, ≈:1370) khi giữ cột.
- Màu: chỉ dùng token `@theme` có sẵn, không dùng hex.

## Kiểm tra

- Logic thuần (ô nào hiện, màu cảnh báo theo ngưỡng 1 GB) tách ra thành model có test vitest bên cạnh, theo quy ước
  `foo.ts` + `foo.test.ts`.
- Một scenario CDP trong `scripts/cdp/scenarios.mjs` mở surface Agent với fixture có đủ các loại dòng: agent có
  badge chưa đọc, lead có run và thanh task, dòng đang hỏi, và agent đang sống có `OriginChip` `N runs` giữ ≥ 1 GB. Chụp sidebar để so với
  prototype: ba cột thẳng hàng giữa mọi loại dòng, ô RAM ≥ 1 GB màu cảnh báo, chấm chưa đọc nằm trên dòng tên, sidebar
  rộng 280px.
- `task check:ts` sạch.
- Thêm một dòng `Changed` trong `CHANGELOG.md`: sidebar Agent rộng hơn một chút, các cột RAM · token · tuổi thẳng hàng
  trên mọi dòng, RAM từ 1 GB hiện màu cảnh báo.
