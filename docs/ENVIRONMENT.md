# Môi trường đã biết

> File này được nạp vào mọi session qua `CLAUDE.md`. Ghi các bẫy của máy dev và công cụ, đúng cho mọi session; chuyển từ STATUS sang ở M1.8 để STATUS chỉ còn trạng thái.

- Windows 11, PowerShell 5.1 + Git Bash; Node v24.21.0, pnpm 12.11.2 (global), Docker 29.5.3. Git 2.41 (`core.autocrlf=true` ở mức system → repo dùng `.gitattributes` `eol=lf`).
- Postgres 16 cài sẵn trên Windows chiếm port 5432, nên Postgres của dự án (Docker) chạy ở 5433.
- oxlint không in gì trong Claude Code khi không có lỗi; thêm `--format=default` để thấy tổng kết.
- Prisma 7.10 (pin; bỏ qua banner update lên 8.0): không tự đọc `.env` (config dùng `process.loadEnvFile()`); `migrate dev` không tự `generate` hay seed; `migrate reset` bị Prisma chặn khi chạy từ AI agent, phải hỏi user. Docs: đọc trang `/v7/`, trang không ghi version đã là Prisma 8. Partial unique (preview `partialIndexes`): đừng `findUnique` theo riêng cột đó; điều kiện `IN` viết `raw(...)` đúng chữ Postgres lưu (`= ANY (ARRAY[...])`), không thì `migrate diff` báo drift.
- Cảnh báo `pg` "Calling client.query() when the client is already executing a query": Prisma đọc các relation anh em (cùng một `select`) song song trên connection của một `$transaction`. Ghi trong transaction, đọc lại bên ngoài (như `onboarding.service.ts`, `org.service.ts`). Phải đọc trong transaction (vd `sendInvitation` soạn email) thì mỗi lần đọc chỉ lồng một relation. Tìm chỗ gây ra bằng `NODE_OPTIONS=--trace-deprecation`; stack có khi chỉ tới runtime của Prisma, khi đó rà các `select` trong transaction.
- psql 16 trên Windows: option phải đứng trước connection string.
- Node trên Windows bỏ qua `TZ`: thử code ngày với timezone có DST thì chạy trên Linux (container hoặc CI).
- Kiểm tra UI bằng Playwright CLI (headed), không dùng Claude in Chrome (Chrome của extension ở máy khác). `open` không tự trả về trong Bash tool: ghi output ra file (`> .playwright-cli/cmd.log 2>&1`); `--filename` tính từ thư mục hiện tại. Đăng nhập không lộ mật khẩu: storage state + `state-load` (handoff 011). Trong `snapshot`, nút có phần tử con (vd avatar `aria-hidden` + tên) hiện là `button [ref=…]` không kèm tên: tìm ref theo dòng nhãn ngay trên nó.
- Playwright trên prod: đăng nhập như handoff 011 nhưng gọi `https://joinpath.vercel.app/api/auth/login`, header `origin` cùng host, cookie domain `joinpath.vercel.app` (handoff 015). Script đăng nhập dùng chung `apps/api/.env` cho cả local và prod. Từ máy dev, JS của prod có lúc tải rất chậm dù CDN báo HIT: chờ `find` thấy nội dung rồi mới chụp. Lệnh xem request là `requests`, không phải `network`.
- Lời mời trong Playwright: output của `click`, `goto` (dòng `Page URL`) và file snapshot `.yml` chứa token sau `#` của link mời. Lọc trước khi in (`| sed 's/#.*//'`), lấy ref bằng `grep -o` thay cho in cả snapshot. Ở dev, StrictMode chạy effect hai lần, nên mỗi lần mở `/invite` gọi lookup 2 lần, tốn 2 trong 10 lượt/phút/IP mà login, lookup và accept dùng chung.
- Playwright với file (M2.4a):
  - bấm vùng thả file rồi chạy `upload <file…>` để trả lời hộp chọn file đang mở;
  - `drop <ref> --path <đường dẫn tuyệt đối>` để thả file;
  - ảnh `--full-page` trên Chrome headed hẹp hơn 15 px vì thanh cuộn, ảnh khung nhìn thì đủ. Kiểm tràn ngang bằng `eval` (`scrollWidth` so với `clientWidth`), không dựa vào ảnh;
  - CLI chặn URL `file:`: mở file local qua `python -m http.server <port> --bind 127.0.0.1 --directory <thư mục>` (M3.3a).
- `eval` của Playwright CLI: hàm viết nhiều dòng, hoặc đối số có `"` lồng bên trong, bị Windows từ chối ("batch file arguments are invalid"). Viết hàm trên một dòng, bên trong dùng nháy đơn (M3.2b).
- Auto mode của Claude Code chặn thao tác ghi trên production (bấm Activate, `POST` thẳng vào API) dù kế hoạch đã có: xin user cho phép trong chat, liệt kê đúng từng thao tác; thao tác ngoài danh sách vẫn bị chặn. `vercel env add` (Secret-Store Writes) cũng vậy. Riêng `git push origin main` (Production Deploy) vẫn bị chặn dù user đã đồng ý trong chat: user tự gõ `! git push origin main` (M2.5).
- Git Bash đổi đối số bắt đầu bằng `/` (vd `/tasks/mine`, `/entrypoint.sh`) thành đường dẫn Windows khi gọi chương trình native như `node`, `docker`: đặt `MSYS_NO_PATHCONV=1`.
- Storage (từ M2.2): RustFS 1.0.1 trong compose, port 9000.
  - MinIO không còn image để pull: Quay báo "no such manifest", Docker Hub từ chối. Máy còn bản cache `quay.io/minio/minio` và `quay.io/minio/mc` của 2025, không dùng nữa.
  - RustFS đọc key từ `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY` (mặc định `rustfsadmin`). `GET /health` trả 200; trong image có `curl`. Chỉ nhận path-style URL, trừ khi đặt `RUSTFS_SERVER_DOMAINS`.
  - Volume mới (lần đầu, hoặc sau khi xóa volume `joinpath_s3data`) chưa có bucket: chạy `pnpm storage:init` sau `pnpm build`, trước khi chạy test hay upload ở dev.
  - Dev và test dùng chung bucket `joinpath`. Từ M3.3a test dọn org bằng `purgeOrg` (xóa cả object theo prefix `orgs/{orgId}/`); object do các lần chạy trước đó để lại nằm tới khi xóa volume. `docker compose down -v` xóa cả volume của Postgres.
  - `pnpm db:seed` cần `S3_*` và bucket (onboarding B, C upload file), trừ khi chạy `--no-scenarios`. Giả lập thiếu một biến của `.env` bằng cách đặt nó rỗng trước lệnh (`S3_ENDPOINT= pnpm …`): biến rỗng trong môi trường thắng `--env-file` (M3.3a).
- `seed.yml` chạy trên GitHub Actions, xa Neon: mỗi query mất vài trăm ms, nên transaction của `seedDemoOrg` để timeout 30 s. Seed xóa org `acme` trước, ngoài transaction: seed fail là prod mất org demo tới lần chạy sau.
- Đừng `pnpm build` khi `pnpm dev` đang chạy (`nest build` xóa `dist`, api dev chết). Dừng `pnpm dev` chạy nền không tắt node của next và nest: `Stop-Process` theo command line.
- Script Python sửa file repo: đọc, ghi với `newline=""` (không thì thành CRLF); in output vitest cần `PYTHONIOENCODING=utf-8` (`python -I` bỏ qua biến này: dùng `sys.stdout.reconfigure(encoding='utf-8')`).
  - Heredoc `python - <<'EOF'` dài, có nhiều dấu nháy đơn, có lúc bị Bash tool báo "unexpected EOF while looking for matching `''": ghi script vào scratchpad bằng Write rồi chạy `python -I <file>` (M3.1a).
  - `$TMP` của Git Bash không phải scratchpad của session: file tạm, bản sao lưu thì dùng đường dẫn scratchpad tuyệt đối.
- Việc cần Linux (vd kiểm TZ có DST): image `node:20-alpine` có sẵn trong Docker của máy; mount `packages/core` read-only rồi chạy script import `core/dist` (handoff 023).
- Sửa `packages/core` khi `pnpm dev` đang chạy: web có thể giữ bản core cũ, nên build core rồi restart `pnpm dev`. Sửa `app-shell.tsx` lúc dev đang chạy cũng vậy: SSR giữ bản cũ, gây lỗi hydration (handoff 013).
- Xóa một route của web xong, `pnpm typecheck` báo không tìm thấy trang đó: `apps/web/.next/dev/types/validator.ts` do dev server sinh ra vẫn trỏ tới nó, `next typegen` không tạo lại. Dừng dev rồi xóa `apps/web/.next/dev/types` (M3.2b).
- Vercel CLI 62.2.0 (global, đã đăng nhập; hook đầu session báo "not installed" là sai). MCP Vercel trả 403 với team này: dùng `vercel api`, `vercel logs`, `vercel inspect --logs`. Không chạy `vercel deploy` từ máy (CLI upload cả `apps/api/.env`).
- Secret không bao giờ in ra transcript. Đặt secret qua file tạm trong scratchpad rồi xóa ngay, hoặc để user tự gõ trong terminal riêng.
- Neon (Postgres 18.6) ngủ sau 5 phút không có truy vấn; request đầu tiên khi đó chậm thêm khoảng 0,9 s.
