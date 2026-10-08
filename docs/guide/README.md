# Hướng dẫn sử dụng arcterm

arcterm là cockpit trên máy bạn để chạy và giám sát coding agent (Claude Code, pi, Antigravity, Codex, OpenCode). Các trang dưới đây viết cho người dùng app; tài liệu cho người phát triển arcterm nằm ở [AGENTS.md](../../AGENTS.md) và [docs/README.md](../README.md).

Mới bắt đầu thì đọc [Bắt đầu với arcterm](getting-started.md): cài đặt, chạy bản dev, đăng ký project, mở agent và run đầu tiên.

## Các surface

| Trang | Nội dung |
|---|---|
| [Cockpit và khung ứng dụng](cockpit.md) | Thẻ mọi agent, dải **Needs you**, app bar, footer, command palette, thông báo, con vật Jarvis |
| [Jarvis](jarvis.md) | Brief, initiative, run sheet, trả lời câu hỏi, hộp Spec / Plan review, profile của run |
| [Agent](agent.md) | Terminal thật của từng agent, sidebar Active và Conversations, grid, rail chi tiết, lịch sử hội thoại |
| [Usage](usage.md) | Quota 5 giờ và tuần, token, chi phí ước tính, thẻ Low RAM |
| [Code](code.md) | Duyệt và sửa file của project, xem Markdown |
| [Diff](diff.md) | Lịch sử git, file đã đổi, diff, so sánh hai ref, review từng dòng |
| [Radar](radar.md) | Audit các commit sửa lỗi, biến phát hiện thành run |
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
