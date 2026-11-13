# Tạm ẩn Jarvis trong X giờ

Brainstorm: `.superpowers/brainstorm/jarvis-snooze/brainstorm.json` (2026-11-13).

## Ý định

Cho Jarvis (Sprout hoặc hologram) tạm biến mất trong X giờ. Hết giờ thì nó tự hiện lại, người dùng không phải tắt hẳn
rồi tự nhớ bật lại.

## Hiện có gì

- Settings → Jarvis → Form (`petFormAtom`, `frontend/app/view/jarvis/petstore.ts`) chỉ có `"sprout" | "hologram"`.
  Chưa có cách tắt Jarvis.
- `PetView` (`frontend/app/view/jarvis/petview.tsx`, mount một lần ở `frontend/app/cockpit/cockpit-root.tsx`) vẽ Jarvis
  ở footer hoặc ở góc dưới phải (hologram), trên gờ của Float và trong vai sếp của Office (`petOfficeBossAtom`).
- Sprout thu nhỏ (`frontend/app/cockpit/sprout-mini.tsx`) đã có "Don't fold for". Nó ghi setting
  `window:autosproutpauseuntil` (Unix ms) và có nút 1 giờ, nút đến 8:00 sáng, ô gõ giờ. Phần logic thuần
  (`foldPaused`, `nextMorning`, `parsePauseText`, tối đa 7 ngày) nằm trong `frontend/app/view/agents/foldpause.ts`.
- Command palette tự sinh hàng từ registry keybinding (`frontend/app/cockpit/palette-commands.ts`). Lệnh không có
  phím tắt thì dùng key `"cmd:<slug>"`.

## Thiết kế

### Chỗ bấm ẩn

Chuột phải trên Jarvis (Sprout hoặc hologram, ở mọi chỗ `PetView` vẽ nó) mở context menu (`ContextMenuModel`). Menu
có các mục:

- Ẩn 1 giờ
- Ẩn đến 8:00 (`nextMorning`)
- Ẩn trong… (gõ giờ như ô của "Don't fold for", dùng `parsePauseText`: "2h", "30m", "1h30", "14:30", "8pm"; tối đa
  7 ngày)

Cả ba mục chỉ ghi `jarvis:hiddenuntil`.

### Bật lại sớm

Lệnh "Hiện Jarvis" trong command palette (Ctrl+P), key `cmd:show-jarvis`, ghi `jarvis:hiddenuntil` = 0 để Jarvis hiện
lại ngay. Màn hình không có thêm gì khác. Lệnh này chỉ có trong danh sách lúc Jarvis đang ẩn.

### Lúc đang ẩn

Không có hình, cũng không có bong bóng, cho tới khi hết giờ hoặc người dùng chạy "Hiện Jarvis". Câu Jarvis định nói
trong lúc ẩn (thông báo, quote) bị bỏ chứ không dồn lại để nói sau, nên watermark của bong bóng vẫn đi tới bình thường.
Việc cần người dùng vẫn được đếm ở badge Cockpit và Jarvis trên thanh nav (`navrail.tsx`), không có gì kéo Jarvis về
sớm.

Lúc bấm ẩn, bong bóng đang hiện bị đóng và dấu chưa đọc (`petUnreadAtom`) bị xoá, như `openPetPeek` vẫn làm, để không
có dấu chưa đọc nào bật lại sau vài giờ cho một việc đã xong từ lâu. Peek đang mở thì giữ nguyên. (Agent's call)

Peek vẫn mở được lúc Jarvis đang ẩn, bằng Ctrl+J / ⌘J, `g w` và mọi chỗ `openref.ts` mở vào peek (`startPeek`). Khi
không có phần tử Jarvis để bám, `PetPeek` đặt cố định ở góc dưới phải, chỗ hologram đứng. Mở peek không làm Jarvis
hiện lại. (builder question 1)

Sprout thu nhỏ (fold) vẫn hiện nhưng cũng im: gate "bỏ câu nói" nằm trong speech effect của `PetView` cho mọi trường
hợp, kể cả lúc fold, và timer quote cũng dừng. (Agent's call)

### Ẩn ở đâu

Jarvis ẩn ở cả ba chỗ nó xuất hiện trong app: footer hoặc góc của cửa sổ chính (Sprout hoặc hologram), gờ của cửa sổ
Float, và vai sếp trong Office. Sprout thu nhỏ (cửa sổ đã fold) vẫn giữ nguyên, vì lúc đó cả cửa sổ chỉ còn Sprout và
đó là chỗ duy nhất để mở cửa sổ ra lại.

- **Float.** Float không có thanh nav, nên con số việc đang chờ (và chip đang chạy) vẫn nằm trên gờ của Float, ở đúng
  chỗ Sprout đứng; chỉ có Sprout là ẩn. Thêm một bước CDP cho trạng thái này. (builder question 2)
- **Office.** Sếp do `cockpitoffice.tsx` vẽ, không phải `PetView`. Lúc ẩn thì Office không vẽ sếp nữa nhưng vẫn giữ chỗ
  của sếp (bàn trống), nên bố cục phòng không đổi. Office cũng không được để `PetView` quay sang vẽ Sprout ở footer:
  `inOffice` vẫn đúng chừng nào Office còn mở. Hết ẩn mà Office đang mở thì sếp vào bằng đúng màn teleport như lúc mở
  Office. (Agent's call)
- **Màn khởi động.** Đang ẩn thì `startuploader.tsx` không vẽ Sprout hay hologram, chỉ giữ dòng chữ báo arcterm đang
  khởi động. Nhờ vậy lúc ẩn không có context WebGL nào được tạo, kể cả lúc mở app. (Agent's call)

### Lưu và hết giờ

- Setting mới `jarvis:hiddenuntil` (Unix ms, 0 hoặc không có là không ẩn) đặt trong `pkg/wconfig/settingsconfig.go`
  cạnh `window:autosproutpauseuntil`, rồi chạy `task generate` và thêm vào `schema/settings.json`. Khởi động lại
  arcterm thì vẫn còn ẩn, và mọi cửa sổ đọc cùng một giá trị.
- Một file thuần mới `frontend/app/view/jarvis/pethide.ts` (có `pethide.test.ts`) giữ `jarvisHidden(raw, now)` theo
  kiểu `foldPaused`, cùng phần dựng các mục menu từ `now`. Mọi chỗ khác dùng lại `nextMorning` và `parsePauseText`
  của `foldpause.ts`, không chép lại.
- Một timer đặt đúng lúc hết giờ để Jarvis tự hiện mà không cần reload. Khi setting đổi thì đặt lại timer.

### RAM khi ẩn

Ẩn nghĩa là `PetView` không render hình Jarvis nào, chứ không phải đặt opacity 0. Canvas của hologram, context WebGL
của nó và vòng `requestAnimationFrame` (`useHologramCanvas`) vì thế được giải phóng, và timer quote hay walk cũng
không chạy. Đo RAM của webview lúc hologram đang hiện và lúc đang ẩn, rồi ghi hai số đo vào mục "RAM watch" của
`docs/open-issues.md`.

### Changelog

Thêm một dòng vào mục `Added` của `CHANGELOG.md`, viết cho người dùng: chuột phải trên Jarvis để ẩn nó một lúc,
Ctrl+P → "Hiện Jarvis" để gọi về sớm.

## Để builder quyết

- Chữ chính xác của các mục menu và của lệnh palette (theo `DESIGN.md`).
- Ô gõ giờ "Ẩn trong…" nằm ngay trong menu hay mở một ô nhập nhỏ.
- Timer hết giờ đặt ở `PetView` hay ở store.

## Kiểm tra

- Vitest cho `pethide.ts`: chưa đặt, 0, đã qua giờ, còn giờ, và các mục menu dựng từ một `now` cố định.
- Một CDP scenario trong `scripts/cdp/scenarios.mjs`: ghi `jarvis:hiddenuntil` vào tương lai thì không còn
  `[data-pet-sprite]` lẫn canvas hologram; chạy lệnh palette "Hiện Jarvis" thì Jarvis hiện lại; chuột phải trên Jarvis
  thì menu có ba mục ẩn.
