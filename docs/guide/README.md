# Hướng dẫn sử dụng arcterm

arcterm là cockpit trên máy bạn để chạy và giám sát coding agent (Claude Code, pi, Antigravity, Codex, OpenCode). Các trang dưới đây viết cho người dùng app; tài liệu cho người phát triển arcterm nằm ở [AGENTS.md](../../AGENTS.md) và [docs/README.md](../README.md).

Mới bắt đầu thì đọc [Bắt đầu với arcterm](getting-started.md): cài đặt, chạy bản dev, đăng ký project, mở agent và run đầu tiên.

Đã dùng một thời gian rồi thì lướt [Tính năng dễ quên](features.md): những tính năng hay, gom theo tình huống, kèm phím tắt, cập nhật tới 0.15.20.

## Các surface

| Trang | Nội dung |
|---|---|
| [Cockpit và khung ứng dụng](cockpit.md) | Thẻ mọi agent, dải **Needs you**, app bar, footer, command palette, thông báo, con vật Jarvis |
| [Jarvis](jarvis.md) | Brief, initiative, run sheet, trả lời câu hỏi, hộp Spec / Plan review, profile của run |
| [Agent](agent.md) | Terminal thật của từng agent, cây project và Conversations, Overview của project, grid, rail chi tiết (Files, Changes, Transcript), lịch sử hội thoại |
| [Council](council.md) | Nhóm agent chuyên gia review hay brainstorm một câu hỏi: ghế ngồi, chat, đính kèm, báo cáo, `wsh council` |
| [Brainstorm](brainstorm.md) | Pane brainstorm cạnh terminal: từng câu hỏi, judge, bản thiết kế, mockup, builder check, Approve |
| [Usage](usage.md) | Quota 5 giờ và tuần, token, chi phí ước tính, hàng đợi lệnh nặng |
| [Code](code.md) | Duyệt và sửa file của project, xem Markdown |
| [Diff](diff.md) | Lịch sử git, file đã đổi, diff, đánh dấu đã review, comment từng dòng, commit và sync, so sánh hai ref |
| [Radar](radar.md) | Audit lỗi anh em, lỗi do thay đổi đưa vào và file hotspot; biến phát hiện thành run |
| [Setup](setup.md) | Instructions và skills dùng chung cho mọi harness |
| [Settings](settings.md) | Tài khoản Claude, route của run, giao diện, terminal, thông báo |

## Run và orchestrator

| Trang | Nội dung |
|---|---|
| [Orchestrator](orchestrator.md) | Quick, orchestrate từ goal hay plan file, review plan, merge và Verify, final stage, land, khôi phục, CLI |
| [Plan file](plan-format.md) | Định dạng plan mà engine chạy: task, Depends on, Verify, Setup, Check, Final, Model |

## Agent và `wsh`

| Trang | Nội dung |
|---|---|
| [Tích hợp agent](agent-integration.md) | arcterm cài gì vào từng harness, mod Claude, Antigravity, `wsh` cho agent, skills đi kèm |

## Tham khảo

- [Phím tắt](../keyboard-shortcuts.md) — bảng phím đầy đủ (tiếng Anh).
- [CHANGELOG](../../CHANGELOG.md) — thay đổi theo phiên bản.
- [Kiến trúc](../reference/architecture.md) — bản đồ desktop, backend, frontend (tiếng Anh).

Trên macOS các phím dùng `Cmd` thay cho `Ctrl`; các trang viết theo Windows.
