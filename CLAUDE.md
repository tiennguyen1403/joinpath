# Joinpath · hướng dẫn cho Claude Code

Joinpath là nền tảng onboarding nhân viên, dự án portfolio full-stack. Kế hoạch: `docs/PLAN.md`. Thiết kế: canvas "Joinpath Screens" https://claude.ai/artifact/Xr3pRZbd14D78pqUignjWV (đọc bằng Artifact tool, action `read`). Trạng thái hiện tại và các bẫy của môi trường dev được nhúng ở cuối file này.

## Quy trình session

Dự án chạy qua nhiều session ngắn; mỗi session là một dòng trong bảng ở `docs/STATUS.md`.

**Mở session:** user gõ `/session-start`.
- Các bước nằm trong `.claude/skills/session-start/SKILL.md`, là danh sách bước đầy đủ duy nhất: đọc STATUS và handoff, đối chiếu git, tóm tắt, chờ user xác nhận rồi mới làm.
- User mở session mà không gõ lệnh: đọc file đó và làm đúng các bước. Claude không tự gọi được skill này (`disable-model-invocation`).

**Trong session:**
- Chỉ làm việc của session này. Thấy việc ngoài phạm vi: ghi vào handoff, không tự làm.
- Việc lớn hơn dự kiến, hoặc user báo `/context` đã quá nửa (Claude không tự xem được mức context): dừng ở điểm sạch (build và test xanh), đóng session, chuyển phần còn lại sang session tách (M?.?a / M?.?b).

**Đóng session:** luôn gọi skill `session-end` bằng Skill tool, kể cả khi user không gõ `/session-end` và khi đóng sớm ở điểm sạch.
- Không tự đóng theo trí nhớ: hai lần đóng tay (M3.3d, M3.4a) đều sót bước cuối của skill.
- Skill là danh sách bước đầy đủ duy nhất: kiểm chứng, handoff, STATUS, commit local, chép bảng canvas được duyệt, báo user và nhắc mở session mới.
- Commit local và chép bảng canvas được duyệt đã được user cho phép sẵn, không hỏi lại. **Không push.**

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
- Bảng phương án: tự dựng từng bảng ở local, đo, chụp và so với bảng "trước", sửa xong mới đưa user duyệt, kèm kết quả kiểm (cách làm: ENVIRONMENT, mục Playwright). Không chờ user yêu cầu, kể cả khi hướng dẫn của loại canvas Design bảo không tự kiểm.
- Test: tên test chứa ID của BR hoặc kịch bản (vd `T05`, `AT-12`); integration chạy với Postgres thật (PLAN §12).

@docs/STATUS.md
@docs/ENVIRONMENT.md
