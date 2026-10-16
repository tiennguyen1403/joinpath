---
description: Mở session mới từ handoff — đọc STATUS và handoff gần nhất, đối chiếu git, tóm tắt và chờ xác nhận mục tiêu
argument-hint: "[ghi chú thêm cho session]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(git status *) Bash(git log *) Bash(git diff *)
---

Mở session. `CLAUDE.md` trỏ tới đây: đây là danh sách bước đầy đủ duy nhất.

1. Đọc `docs/STATUS.md` và file handoff mới nhất trong `docs/sessions/` (file `NNN-*.md` có NNN lớn nhất; bỏ qua `TEMPLATE.md`).
2. Chạy `git status --short` và `git log --oneline -5`. Commit mới nhất phải có message bắt đầu bằng ID của handoff đó. Nếu có thay đổi chưa commit hoặc commit không khớp, báo user trước khi làm gì khác.
3. Đọc những mục "Đọc trước" mà handoff chỉ định, chỉ phần cần cho session này.
4. Trả lời user ngắn gọn bằng tiếng Việt:
   - Session này: ID, mục tiêu, tiêu chí "xong khi" (theo bảng trong STATUS).
   - Việc còn dở và lưu ý từ handoff trước.
   - Các bước dự kiến (3–7 bước) và bước đầu tiên.
   - Câu hỏi cần user chốt trước khi làm, nếu có.
5. Dừng và chờ user xác nhận. Chưa sửa file nào ở bước này.

Ghi chú của user cho session này (có thể trống): $ARGUMENTS
