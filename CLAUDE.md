# Joinpath · hướng dẫn cho Claude Code

Joinpath là nền tảng onboarding nhân viên, dự án portfolio full-stack. Kế hoạch: `docs/PLAN.md`. Thiết kế: canvas "Joinpath Screens" https://claude.ai/artifact/Xr3pRZbd14D78pqUignjWV (đọc bằng Artifact tool, action `read`). Trạng thái hiện tại được nhúng ở cuối file này.

## Quy trình session

Dự án chạy qua nhiều session ngắn; mỗi session là một dòng trong bảng ở `docs/STATUS.md`.

**Mở session** (hoặc user gõ `/session-start`):
1. Đọc STATUS (bên dưới) và handoff mới nhất trong `docs/sessions/` (file `NNN-*.md` có NNN lớn nhất).
2. Chạy `git status --short` và `git log --oneline -5`; commit mới nhất phải bắt đầu bằng ID của handoff đó. Lệch thì báo user trước.
3. Tóm tắt cho user: đang ở đâu, mục tiêu và tiêu chí "xong khi" của session này, các bước dự kiến. Chờ user xác nhận rồi mới làm.

**Trong session:**
- Chỉ làm việc của session này. Thấy việc ngoài phạm vi: ghi vào handoff, không tự làm.
- Việc lớn hơn dự kiến, hoặc user báo `/context` đã quá nửa (Claude không tự xem được mức context): dừng ở điểm sạch (build và test xanh), đóng session, chuyển phần còn lại sang session tách (M?.?a / M?.?b).

**Đóng session** (hoặc `/session-end`):
1. Chạy đủ kiểm chứng của session; ghi kết quả thật, kể cả phần fail.
2. Viết `docs/sessions/NNN-<ID>-<slug>.md` theo `docs/sessions/TEMPLATE.md`.
3. Cập nhật `docs/STATUS.md` (dòng "Cập nhật", mốc, session kế tiếp, cột TT, quyết định còn mở, lệnh chạy dự án).
4. Commit local, đã được user cho phép sẵn: `git add -A`, message `<ID>: <tóm tắt>`. **Không push.**

## Luật cứng

- Chưa rõ điều gì thì hỏi user cho đến khi rõ hẳn; không tự quyết thay user.
- Không đi lại các quyết định đã chốt (PLAN §1, §15, các ADR). Muốn đổi: nêu lý do và hỏi trước.
- Trước khi đề xuất thu hẹp hay đổi phạm vi một tính năng, grep PLAN §1, §15 và bảng FR theo từ khóa của tính năng đó.
- Hỏi trước mỗi lần làm việc hướng ra ngoài: tạo GitHub repo, push, deploy, tạo tài khoản hoặc secret trên dịch vụ ngoài, cài phần mềm global.
- Ngôn ngữ: UI, code, comment, README, ADR viết tiếng Anh. Tài liệu nội bộ (PLAN, STATUS, handoff, file này) viết tiếng Việt, giữ thuật ngữ tiếng Anh. User trao đổi bằng tiếng Việt.
- Stack và version pin theo PLAN §6.2 (Next.js 16, NestJS 12 ESM, Prisma 7.10, TypeScript 6.0, Vitest 4, pnpm 12, Node 24 LTS, Postgres 18). Không thêm thư viện ngoài plan khi chưa hỏi.
- Kiến trúc theo PLAN §6.3–§6.6: `packages/core` là TS thuần, không I/O; module NestJS gọi Prisma trực tiếp, không có repository; quyền viết thành hàm thuần trong `*.policy.ts`.
- UI: dùng component beUI có sẵn (registry `https://beui.dev/r`, map ở PLAN §10.1) và icon `reicon-react`; token theo bảng Foundations; không dùng control mặc định của trình duyệt. Chỉ ba chỗ lệch beUI (ADR 009): `#0067D1` cho chữ trắng trên primary và link; hover là lớp foreground 5% (8% khi nhấn); active nav nền `#E3F0FC`, chữ `#0067D1`. Không thêm shadow cho card và bề mặt tĩnh.
- Đổi giao diện so với canvas: làm bản so sánh trước/sau cho user duyệt rồi mới áp dụng.
- Test: tên test chứa ID của BR hoặc kịch bản (vd `T05`, `AT-12`); integration chạy với Postgres thật (PLAN §12).

@docs/STATUS.md
