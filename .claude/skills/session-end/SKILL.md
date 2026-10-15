---
description: Đóng session — chạy kiểm chứng, viết handoff, cập nhật STATUS và commit local (không push)
argument-hint: "[ghi chú thêm cho handoff]"
allowed-tools: Read Grep Glob Edit Write Artifact Bash(git status *) Bash(git log *) Bash(git diff *) Bash(git add *) Bash(git commit *)
---

Đóng session theo quy trình trong `CLAUDE.md`:

1. Chạy đủ các lệnh kiểm chứng trong tiêu chí "xong khi" của session (build, test, lint, typecheck tùy giai đoạn). Ghi kết quả thật; phần fail thì ghi là fail, không giấu.
2. Lấy số NNN tiếp theo (NNN lớn nhất trong `docs/sessions/` cộng 1, đủ 3 chữ số) và viết `docs/sessions/NNN-<ID>-<slug>.md` theo `docs/sessions/TEMPLATE.md`. Viết sao cho một session mới không có transcript này vẫn làm tiếp được: file đã đổi, quyết định và lý do, lệnh kiểm chứng và kết quả, phần còn dở, bước đầu tiên của session sau.
3. Cập nhật `docs/STATUS.md`: dòng "Cập nhật", mốc hiện tại, session kế tiếp, cột TT trong bảng, quyết định còn mở, mục "Chạy dự án" nếu lệnh thay đổi. Giữ STATUS ngắn (dưới 10.000 ký tự); lịch sử chi tiết để trong handoff.
4. Quyết định lớn trong session: ghi ADR hoặc cập nhật PLAN nếu user đã duyệt; chưa duyệt thì đưa vào "Quyết định còn mở", không tự sửa PLAN.
5. `git add -A` rồi commit với message `<ID>: <tóm tắt>`, kết thúc bằng dòng ghi công theo hướng dẫn hiện hành của Claude Code. Không push.
6. Session có bảng canvas được duyệt: chép vào canvas chính "Joinpath Screens", không hỏi lại (user cho phép sẵn từ 15/10/2026). Hàng mới "N · <tên> (approved in <ID>)" dưới hàng cuối; chỉnh cho khớp bản đã build; không chép phương án bị loại; không sửa bảng cũ. Ghi version canvas vào mục "Còn dở" của handoff rồi commit nhỏ `<ID>: note the approved boards copied into the design canvas`.
7. Báo user ngắn gọn bằng tiếng Việt: kết quả so với tiêu chí, đường dẫn handoff, session kế tiếp. Nhắc user mở session mới (thoát và chạy lại `claude`, hoặc `/clear`) rồi gõ `/session-start`.

Ghi chú của user cho handoff (có thể trống): $ARGUMENTS
