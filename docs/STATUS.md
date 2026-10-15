# Trạng thái dự án

> File này được nạp vào mọi session qua `CLAUDE.md`. Giữ ngắn: chỉ trạng thái hiện tại. Lịch sử chi tiết nằm trong `docs/sessions/`.

**Cập nhật:** 2026-10-15 · session 012 (M1.6b · Wizard)
**Mốc hiện tại:** M1 · Workflow engine, xong M1.1–M1.6b (xem bảng). M0 · Walking skeleton đã xong: CI trên GitHub Actions, demo public tại https://joinpath.vercel.app.

**Session kế tiếp:** **M1.7 · Web: onboarding detail + My Tasks** (xem bảng). Handoff mới nhất: `docs/sessions/012-M1.6b-wizard.md`; dữ liệu đọc từ canvas nằm ở handoff 005, 008 và 009.

## Quy ước session

- Mỗi session = một lát cắt kiểm chứng được, có tiêu chí "xong khi". Xong thì đóng session, kể cả khi xong sớm.
- Session đầu của mỗi mốc M1–M5 chi tiết hóa lại các session của mốc đó (sửa bảng dưới) trước khi code.

## Bảng session

Trạng thái: ✅ xong · ▶ kế tiếp · ⏳ chưa làm. Mốc M2–M5 mới ở mức khung.

| ID | Nội dung | Xong khi | TT |
|---|---|---|---|
| S0 | Kế hoạch, canvas 15 bảng, khung handoff | Có PLAN, canvas, STATUS | ✅ |
| M0.1 | Khung repo: pnpm workspace (web, api, `core`), TS 6.0, oxlint, Postgres qua Docker | Build, test, lint, typecheck xanh | ✅ |
| M0.2 | Prisma, seed org `acme`, login / logout / me bằng cookie session, Origin check, throttle, helmet | Test Supertest pass | ✅ |
| M0.3 | Web shell: Tailwind 4 + beUI, reicon, trang login, layout theo vai | Đăng nhập qua UI, khớp canvas | ✅ |
| M0.4 | GitHub + CI, deploy Vercel Services + Neon (ADR 011) | URL public đăng nhập được; CI xanh | ✅ |
| M1.1 | `core`: schema template + `validateTemplate` | BR-T04…T11 pass | ✅ |
| M1.2 | `core`: ngày, availability, overdue, `planActivation` | Unit test nhóm A, E, R pass | ✅ |
| M1.3 | API template (chỉ HR), seed template, audit | AT-01…AT-04, BR-T02 pass | ✅ |
| M1.4a | API draft onboarding, employees, departments, phạm vi xem | AT-11, BR-P01, P02 pass | ✅ |
| M1.4b | API `today(org)`, preview, activate; task trong detail | AT-05, AT-07…AT-10 pass | ✅ |
| M1.5 | API task `start`/`complete`, onboarding tự COMPLETED, My Tasks, đồng hồ demo | AT-12…AT-14, AT-23, AT-31 pass | ✅ |
| M1.6a | Web: TanStack Query, bảng Onboardings (`/onboardings`, Dashboard); `GET /onboardings` kèm progress, next task | HR, IT, Manager thấy đúng danh sách qua UI | ✅ |
| M1.6b | Web: wizard 3 bước, chọn và override assignee, activate; header + toast; `today` của org trong `/auth/me` | Activate template seed qua UI; khớp màn NewOnboarding | ✅ |
| **M1.7** | Web: onboarding detail (task theo phase, badge availability) + My Tasks | IT và Manager complete checklist qua UI; khóa theo ngày/dependency đúng; onboarding tự COMPLETED | ▶ |
| M1.8 | Employees: API tạo, sửa (email lowercase khi ghi, vì unique của `users.email` phân biệt hoa thường) + màn danh sách và form | Integration test employees pass; HR tạo, sửa nhân viên qua UI | ⏳ |
| M1.9 | Templates: danh sách + lịch sử version (chỉ xem); chốt tiêu chí M1; push + deploy (hỏi user) | Tiêu chí M1 (PLAN §13) đạt trên production; nhóm test T, A, E pass (trừ A07, E04 thuộc M2) | ⏳ |
| M2.1 | Invitation + mock inbox + nhận lời mời + resend; phần invitation của AT-10 | | ⏳ |
| M2.2 | MinIO (compose + CI), upload (magic bytes, 4 MB), signed download, need-to-know | | ⏳ |
| M2.3 | Submit revision, approve / reject / rework | Nhóm test R pass | ⏳ |
| M2.4 | Web: portal nhân viên mới, upload, drawer review | | ⏳ |
| M2.5 | Chạy trọn golden path ở local, nhóm test P | Golden path (§11) chạy trọn ở local | ⏳ |
| M3.1 | Đổi ngày, reassign, override deadline, hủy; phần cancel của AT-06 | | ⏳ |
| M3.2 | Thông báo in-app + cron tick | | ⏳ |
| M3.3 | Sandbox mỗi khách + Dynamic Island (đổi vai, ngày nghiệp vụ); phần đổi vai của AT-31 | | ⏳ |
| M3.4 | Dashboard HR + timeline | | ⏳ |
| M3.5 | Demo public end-to-end trên host | **Mốc an toàn** | ⏳ |
| M4.1 | Template editor dạng form + validate tức thì bằng `core` | | ⏳ |
| M4.2 | Lịch sử version + luồng publish trên UI | | ⏳ |
| M4.3 | Dependency graph (React Flow + dagre) | | ⏳ |
| M4.4 | Analytics theo phòng ban + rà FR mức Must | **MVP cut line** | ⏳ |
| M5.1 | Playwright: golden path + quyền xem file | | ⏳ |
| M5.2 | Rà ma trận quyền, cross-tenant, upload; trạng thái rỗng và lỗi; a11y | | ⏳ |
| M5.3 | Checklist hướng dẫn demo + landing page | | ⏳ |
| M5.4 | README, ADR, sơ đồ, kịch bản video | Sẵn sàng đưa vào portfolio | ⏳ |

## Quyết định còn mở

- Người gọi cron tick (PLAN §6.5): chốt ở M3.2. Vercel Hobby chỉ cho cron chạy mỗi ngày một lần, nên nhiều khả năng dùng GitHub Actions `schedule`.
- Preview deployment: origin khác `APP_ORIGIN` nên mọi request ghi bị 403, và preview dùng chung DB với production. Chốt khi bắt đầu dùng PR: tắt preview, hoặc cho phép origin của preview và dùng Neon branch.
- Swagger `/api/docs` (PLAN §8) chưa thuộc session nào; khi thêm phải chỉnh CSP của `helmet`. Gắn vào session nào?
- `image-viewer` (PLAN §10.1) không có trên registry beUI: chọn thay thế ở M2.4 (ứng viên `morphing-lightbox`).
- BR-R01 ở mức template: M1.4a chốt không thêm rule chặn publish. Còn mở cho M4.1: editor có gợi ý (không chặn) khi DOCUMENT và APPROVAL của nó cùng giao `DIRECT_MANAGER` không?
- Nút "Discard draft" (canvas, editor) cần xóa DRAFT, trái PLAN §7 (không xóa bản ghi nghiệp vụ) và §8 (không có endpoint): chốt ở M4.1.
- Onboarding tự COMPLETED qua UI (tiêu chí của M1.7, M1.9): template seed nào cũng có DOCUMENT và APPROVAL, mà tới M2 mới làm xong được. Seed thêm một template chỉ có checklist, hay để phần này cho M2.5? Chốt ở M1.7. API đã kiểm bằng test (BR-C01, AT-23).

## Chạy dự án

```sh
pnpm install
docker compose up -d   # Postgres 18 ở localhost:5433, user/pass/db: joinpath
cp apps/api/.env.example apps/api/.env   # lần đầu: DATABASE_URL, APP_ORIGIN, SEED_PASSWORD
pnpm build             # core/dist + client Prisma (src/generated) + dist của api; test, typecheck, lint cần nó
pnpm db:migrate        # prisma migrate dev (lần đầu, hoặc khi đổi schema)
pnpm db:seed           # tạo lại org acme: lan.pham@acme.joinpath.demo (HR), duc.tran@… (IT), minh.nguyen@… (MEMBER)
pnpm dev               # web http://localhost:3000 (đăng nhập ở /login) · api http://localhost:3001/api/health
pnpm test              # cần Postgres + migration; rồi pnpm lint · pnpm typecheck · pnpm format:check
# Tua ngày nghiệp vụ: POST /api/demo/clock/advance {days} (1–30, org sandbox; acme là sandbox), chưa có UI (M3.3). Đưa đồng hồ local về hôm nay:
docker compose exec -T postgres psql -U joinpath -d joinpath -c "UPDATE organizations SET clock_offset_days = 0 WHERE slug = 'acme'"
pnpm exec playwright-cli -s=joinpath open http://localhost:3000/login   # Chrome có cửa sổ; `show` mở dashboard xem trực tiếp
```

Production: https://joinpath.vercel.app (Vercel Services + Neon Singapore, ADR 011).

```sh
git push origin main          # chạy CI và deploy production; migrate chạy trong bước build
gh workflow run seed.yml      # tạo lại org acme trên prod, xóa sạch dữ liệu cũ của org; mật khẩu là secret SEED_PASSWORD
vercel logs <deployment-url> --since 1h   # log runtime: mỗi request API một dòng, kèm IP và request id
```

Env trên Vercel:
- Tự đặt: `APP_ORIGIN`, `TRUST_PROXY_HOPS=1`, `ENABLE_EXPERIMENTAL_COREPACK=1`.
- Integration Neon cấp: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.

Secret của repo GitHub: `DATABASE_URL` (giá trị unpooled), `SEED_PASSWORD`.

Web đọc `API_URL` (`apps/web/.env.example`). Thêm component beUI: `cd apps/web && pnpm dlx shadcn@4.21.5 add https://beui.dev/r/<slug>.json`, rồi làm theo `apps/web/components/beui/README.md`.

## Môi trường đã biết

- Windows 11, PowerShell 5.1 + Git Bash; Node v24.21.0, pnpm 12.11.2 (global), Docker 29.5.3. Git 2.41 (`core.autocrlf=true` ở mức system → repo dùng `.gitattributes` `eol=lf`).
- Postgres 16 cài sẵn trên Windows chiếm port 5432, nên Postgres của dự án (Docker) chạy ở 5433.
- oxlint không in gì trong Claude Code khi không có lỗi; thêm `--format=default` để thấy tổng kết.
- Prisma 7.10 (pin; bỏ qua banner update lên 8.0): không tự đọc `.env` (config dùng `process.loadEnvFile()`); `migrate dev` không tự `generate` hay seed; `migrate reset` bị Prisma chặn khi chạy từ AI agent, phải hỏi user. Docs: đọc trang `/v7/`, trang không ghi version đã là Prisma 8. Partial unique (preview `partialIndexes`): đừng `findUnique` theo riêng cột đó; điều kiện `IN` viết `raw(...)` đúng chữ Postgres lưu (`= ANY (ARRAY[...])`), không thì `migrate diff` báo drift.
- psql 16 trên Windows: option phải đứng trước connection string.
- Node trên Windows bỏ qua `TZ`: thử code ngày với timezone có DST thì chạy trên Linux (container hoặc CI).
- Kiểm tra UI bằng Playwright CLI (headed), không dùng Claude in Chrome (Chrome của extension ở máy khác). `open` không tự trả về trong Bash tool: ghi output ra file (`> .playwright-cli/cmd.log 2>&1`); `--filename` tính từ thư mục hiện tại. Đăng nhập không lộ mật khẩu: storage state + `state-load` (handoff 011).
- Đừng `pnpm build` khi `pnpm dev` đang chạy (`nest build` xóa `dist`, api dev chết). Dừng `pnpm dev` chạy nền không tắt node của next và nest: `Stop-Process` theo command line.
- Script Python sửa file repo: đọc, ghi với `newline=""` (không thì thành CRLF); in output vitest cần `PYTHONIOENCODING=utf-8` (`python -I` bỏ qua biến này: dùng `sys.stdout.reconfigure(encoding='utf-8')`).
- Sửa `packages/core` khi `pnpm dev` đang chạy: web có thể giữ bản core cũ, nên build core rồi restart `pnpm dev`.
- Vercel CLI 62.2.0 (global, đã đăng nhập; hook đầu session báo "not installed" là sai). MCP Vercel trả 403 với team này: dùng `vercel api`, `vercel logs`, `vercel inspect --logs`. Không chạy `vercel deploy` từ máy (CLI upload cả `apps/api/.env`).
- Secret không bao giờ in ra transcript. Đặt secret qua file tạm trong scratchpad rồi xóa ngay, hoặc để user tự gõ trong terminal riêng.
- Neon (Postgres 18.6) ngủ sau 5 phút không có truy vấn; request đầu tiên khi đó chậm thêm khoảng 0,9 s.
