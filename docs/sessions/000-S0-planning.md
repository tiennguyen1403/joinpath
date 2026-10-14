# Session 000 · S0 · Kế hoạch, thiết kế và bộ khung handoff

- **Ngày:** 2026-10-14 · **Mốc:** trước M0 · **Commit:** message bắt đầu bằng `S0:` (commit đầu tiên của repo)
- **Kết quả:** ✅ xong tiêu chí

## Mục tiêu và tiêu chí "xong khi"

Chốt kế hoạch triển khai, thiết kế giao diện, và quy trình làm việc nhiều session. Xong khi có PLAN đã duyệt, canvas thiết kế đã duyệt, và bộ khung handoff (CLAUDE.md, STATUS, template, hai skill) nằm trong repo.

## Đã làm

- `docs/PLAN.md` v0.9: tinh chỉnh SRS v0.4 từ thread ChatGPT 4 vòng. §1 là quyết định gốc của user, §2 là thay đổi đã được chấp nhận, §15 là quyết định đã xác nhận. Roadmap §13 trỏ sang `docs/STATUS.md`.
- Canvas "Joinpath Screens" (claude.ai Design artifact, bản 29), 15 bảng:
  - hàng 0: Foundations (token beUI, icon reicon, states), Motion, Components (map beUI);
  - hàng 1–4: 12 màn của golden path.
- Bộ khung handoff: `CLAUDE.md` (tự nạp mỗi session, nhúng STATUS), `docs/STATUS.md`, `docs/sessions/TEMPLATE.md`, skill `/session-start` và `/session-end` trong `.claude/skills/`.
- `git init -b main`, `.gitignore`, `.gitattributes` (LF), commit đầu.

## Quyết định trong session

- Stack và version pin: PLAN §6.2. TypeScript 6.0 pin vì TS 7 không còn JS API; Prisma 7.10 pin vì tag `latest` trỏ vào bản 8.0 RC.
- UI dùng token, motion và component của beUI, icon reicon (ADR 009, ADR 010, map ở PLAN §10.1).
  - Ba chỗ lệch beUI user đã duyệt: `#0067D1` cho chữ trắng trên primary; hover là lớp foreground 5% (8% khi nhấn); active nav nền `#E3F0FC`.
  - User đã xem và bác shadow trên card cùng layout inset; giữ giao diện phẳng.
- Điều khiển demo là Dynamic Island của beUI, thay cho thanh demo cũ.
- Quy trình session:
  - Mỗi session là một lát cắt có tiêu chí "xong khi". M0 chia 4 session; M1–M5 mới ở mức khung, session đầu của mỗi mốc sẽ chi tiết hóa lại.
  - Cuối session tự commit local, user đã cho phép. Push, tạo GitHub repo và deploy thì luôn hỏi trước.
  - File handoff được commit vào repo; repo sẽ public.
- Cơ chế Claude Code đã kiểm tra theo docs:
  - `CLAUDE.md` ở gốc được nạp lúc mở session và `@import` được nạp cùng (giữ mỗi file dưới 200 dòng).
  - Lệnh tùy chỉnh viết dạng skill trong `.claude/skills/<tên>/SKILL.md`.
  - Không cần SessionStart hook.

## Kiểm chứng

- Thiết kế: chỉ kiểm tra bằng script (cân bằng thẻ HTML, icon, control mặc định, link golden path); chưa render ảnh.
- Chưa có code nên chưa có test.

## Lệch so với PLAN / STATUS

- Không có.

## Còn dở và nợ kỹ thuật

- ADR 001–010 mới là tiêu đề trong PLAN §14. File ADR thật (tiếng Anh) viết khi tới lúc: ADR 007 (cookie session) ở M0.2; ADR 009 và 010 (UI) ở M0.3; ADR chọn host ở M0.4.

## Session kế tiếp

- **ID và mục tiêu:** M0.1 · Khung repo — pnpm workspace `apps/web`, `apps/api`, `packages/core`, Postgres 18 qua docker compose, script gốc chạy xanh (chi tiết trong bảng STATUS).
- **Bước đầu tiên:** kiểm tra môi trường bằng `node -v` (cần Node 24 LTS), `pnpm -v` (12.x) và `docker version`. Thiếu gì thì hỏi user trước khi cài.
- **Đọc trước:** PLAN §6.2 (stack, version pin), §6.3 (cấu trúc repo), §6.6 (ràng buộc deploy ảnh hưởng cấu trúc), §12 (kiểm thử).
- **Lưu ý:**
  - Dùng generator chính thức (`create-next-app`, Nest CLI) nhưng pin version theo §6.2.
  - API chạy ESM.
  - `packages/core` chỉ phụ thuộc Zod.
  - Formatter (Prettier hay không) hỏi user trước khi thêm.

## Ghi chú môi trường

- Windows 11, PowerShell 5.1 và Git Bash. Git 2.41, user và email đã cấu hình global. `core.autocrlf=true` ở mức system, nên repo dùng `.gitattributes` với `eol=lf`.
- `.claude/settings.local.json` (bật plugin ponytail trên máy này) nằm trong `.gitignore`.
- Bản nháp HTML của thiết kế chỉ có trên canvas claude.ai. Khi làm UI, đọc từng bảng bằng Artifact tool: action `read`, `url` của canvas, `path` `project/<Tên>.dc.html`.
- Memory của Claude Code (`~/.claude/projects/D--Code-joinpath/memory/`) có hồ sơ user và các quyết định thiết kế; repo vẫn là nguồn chính.
