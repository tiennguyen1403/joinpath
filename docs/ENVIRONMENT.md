# Môi trường đã biết

> File này được nạp vào mọi session qua `CLAUDE.md`. Ghi các bẫy của máy dev và công cụ, đúng cho mọi session; chuyển từ STATUS sang ở M1.8 để STATUS chỉ còn trạng thái.

- Windows 11, PowerShell 5.1 + Git Bash; Node v24.21.0, pnpm 12.11.2 (global), Docker 29.5.3. Git 2.41 (`core.autocrlf=true` ở mức system → repo dùng `.gitattributes` `eol=lf`).
- Postgres 16 cài sẵn trên Windows chiếm port 5432, nên Postgres của dự án (Docker) chạy ở 5433.
- oxlint không in gì trong Claude Code khi không có lỗi; thêm `--format=default` để thấy tổng kết.
- Prisma 7.10 (pin; bỏ qua banner update lên 8.0): không tự đọc `.env` (config dùng `process.loadEnvFile()`); `migrate dev` không tự `generate` hay seed; `migrate reset` bị Prisma chặn khi chạy từ AI agent, phải hỏi user. Docs: đọc trang `/v7/`, trang không ghi version đã là Prisma 8. Partial unique (preview `partialIndexes`): đừng `findUnique` theo riêng cột đó; điều kiện `IN` viết `raw(...)` đúng chữ Postgres lưu (`= ANY (ARRAY[...])`), không thì `migrate diff` báo drift.
- Cảnh báo `pg` "Calling client.query() when the client is already executing a query": Prisma đọc nhiều relation song song trên connection của một `$transaction`. Ghi trong transaction, đọc lại bên ngoài (như `onboarding.service.ts`, `org.service.ts`). Tìm chỗ gây ra bằng `NODE_OPTIONS=--trace-deprecation`.
- psql 16 trên Windows: option phải đứng trước connection string.
- Node trên Windows bỏ qua `TZ`: thử code ngày với timezone có DST thì chạy trên Linux (container hoặc CI).
- Kiểm tra UI bằng Playwright CLI (headed), không dùng Claude in Chrome (Chrome của extension ở máy khác). `open` không tự trả về trong Bash tool: ghi output ra file (`> .playwright-cli/cmd.log 2>&1`); `--filename` tính từ thư mục hiện tại. Đăng nhập không lộ mật khẩu: storage state + `state-load` (handoff 011). Trong `snapshot`, nút có phần tử con (vd avatar `aria-hidden` + tên) hiện là `button [ref=…]` không kèm tên: tìm ref theo dòng nhãn ngay trên nó.
- Playwright trên prod: đăng nhập như handoff 011 nhưng gọi `https://joinpath.vercel.app/api/auth/login`, header `origin` cùng host, cookie domain `joinpath.vercel.app` (handoff 015). `SEED_PASSWORD` trong `apps/api/.env` nay giống secret của repo. Từ máy dev, JS của prod có lúc tải rất chậm dù CDN báo HIT: chờ `find` thấy nội dung rồi mới chụp. Lệnh xem request là `requests`, không phải `network`.
- Auto mode của Claude Code chặn thao tác ghi trên production (bấm Activate, `POST` thẳng vào API) dù kế hoạch đã có: xin user cho phép trong chat, liệt kê đúng từng thao tác; thao tác ngoài danh sách vẫn bị chặn.
- Git Bash đổi đối số bắt đầu bằng `/` (vd `/tasks/mine`) thành đường dẫn Windows khi gọi chương trình native như `node`: đặt `MSYS_NO_PATHCONV=1`.
- `seed.yml` chạy trên GitHub Actions, xa Neon: mỗi query mất vài trăm ms, nên transaction của `seedDemoOrg` để timeout 30 s. Seed xóa org `acme` trước, ngoài transaction: seed fail là prod mất org demo tới lần chạy sau.
- Đừng `pnpm build` khi `pnpm dev` đang chạy (`nest build` xóa `dist`, api dev chết). Dừng `pnpm dev` chạy nền không tắt node của next và nest: `Stop-Process` theo command line.
- Script Python sửa file repo: đọc, ghi với `newline=""` (không thì thành CRLF); in output vitest cần `PYTHONIOENCODING=utf-8` (`python -I` bỏ qua biến này: dùng `sys.stdout.reconfigure(encoding='utf-8')`).
- Sửa `packages/core` khi `pnpm dev` đang chạy: web có thể giữ bản core cũ, nên build core rồi restart `pnpm dev`. Sửa `app-shell.tsx` lúc dev đang chạy cũng vậy: SSR giữ bản cũ, gây lỗi hydration (handoff 013).
- Vercel CLI 62.2.0 (global, đã đăng nhập; hook đầu session báo "not installed" là sai). MCP Vercel trả 403 với team này: dùng `vercel api`, `vercel logs`, `vercel inspect --logs`. Không chạy `vercel deploy` từ máy (CLI upload cả `apps/api/.env`).
- Secret không bao giờ in ra transcript. Đặt secret qua file tạm trong scratchpad rồi xóa ngay, hoặc để user tự gõ trong terminal riêng.
- Neon (Postgres 18.6) ngủ sau 5 phút không có truy vấn; request đầu tiên khi đó chậm thêm khoảng 0,9 s.
