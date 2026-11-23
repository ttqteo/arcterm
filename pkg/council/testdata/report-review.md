# Hội đồng: Thêm tập cá npm vào benchmark

Bạn hỏi: Nên thêm tập cá npm vào benchmark trước hay sửa lại chương 3?

## Hướng đã chọn

Thêm npm trước

Bạn ghim · từ P1 · 2023-11-14 22:13 UTC

_Người dùng đã chốt hướng này: nó đứng trên báo cáo bên dưới ở chỗ hai bên khác nhau._

**Thêm tập npm trước, rồi sửa chữ chương 3.**

Tập npm làm đổi số liệu của chương 3, nên sửa chữ sau khi có số liệu mới.

## Việc cần làm

| # | Việc | Vì sao | File đụng tới | Loại |
|---|---|---|---|---|
| 1 | Thêm 20 gói npm có CVE vào benchmark | Tập npm đổi các con số của chương 3. | `benchmark/npm.csv`, `docs/ch3.tex` | việc mới |
| 2 | Sửa chữ chương 3 | Chương 3 còn hai chỗ viết sai tên tập. | — | — |

## Số liệu

| Giá trị | Đo gì | Nguồn |
|---|---|---|
| 60 ca | số ca benchmark hiện có | `results/m5.json:12` |

## Đã chốt

- Số liệu chương 3 lấy từ results/m5.json

## Đã loại

- Bỏ tập PyPI (vì sao: không có CVE nào)

## Còn mở

- Có cần đủ 60 gói không?

## Đề xuất cuối cùng

_Từ Phương pháp_

## Thêm 20 gói npm có CVE trước

Tập npm đổi các con số của chương 3.

- results/m5.json:12

Lập luận đầy đủ, cuộc thảo luận và cách hội đồng làm việc: [2026-11-23-them-tap-ca-npm.discussion.md](2026-11-23-them-tap-ca-npm.discussion.md).
