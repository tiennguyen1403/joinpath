# Trạng thái dự án

> File này được nạp vào mọi session qua `CLAUDE.md`. Giữ ngắn: chỉ trạng thái hiện tại. Lịch sử chi tiết nằm trong `docs/sessions/`.

**Cập nhật:** 2026-10-15 · session 009 (M1.4b · Preview và activate)
**Mốc hiện tại:** M1 · Workflow engine, xong M1.1–M1.4b (`core`; API template; API onboarding tới activate). M0 · Walking skeleton đã xong (xem bảng): CI trên GitHub Actions, demo public tại https://joinpath.vercel.app.

**Session kế tiếp:** **M1.5 · API task** (xem bảng). Handoff mới nhất: `docs/sessions/009-M1.4b-activation.md`; dữ liệu đọc từ canvas nằm ở handoff 005, 008 và 009.

## Quy ước session

- Mỗi session = một lát cắt kiểm chứng được, có tiêu chí "xong khi". Xong thì đóng session, kể cả khi xong sớm.
- Việc lớn hơn dự kiến, hoặc user thấy `/context` đã quá nửa (user là người theo dõi mức context): dừng ở điểm sạch, ghi phần dở vào handoff, tách thành M?.?a / M?.?b.
- File handoff: `docs/sessions/NNN-<ID>-<slug>.md` (NNN tăng dần toàn dự án, theo `docs/sessions/TEMPLATE.md`).
- Session đầu của mỗi mốc M1–M5 chi tiết hóa lại các session của mốc đó (sửa bảng dưới) trước khi code.

## Bảng session

Trạng thái: ✅ xong · ▶ kế tiếp · ⏳ chưa làm. Mốc M2–M5 mới ở mức khung.

| ID | Nội dung | Xong khi | TT |
|---|---|---|---|
| S0 | Kế hoạch (PLAN v0.9), thiết kế 15 bảng, bộ khung handoff | Có PLAN, canvas, CLAUDE.md, STATUS, template | ✅ |
| M0.1 | Khung repo: pnpm workspace (web, api, `core`), TS 6.0, oxlint, Postgres 18 qua Docker | Build, test, lint, typecheck xanh; web và api chạy, cả hai import được `core` | ✅ |
| M0.2 | Prisma (5 bảng), seed nhân sự org `acme`, login / logout / me bằng cookie session, Origin check, throttle, helmet | Test Supertest với Postgres thật pass | ✅ |
| M0.3 | Web shell: Tailwind 4 + token beUI, component beUI, reicon, trang login, layout theo vai trò | Đăng nhập qua UI ở local, sidebar đúng vai trò, khớp canvas | ✅ |
| M0.4 | GitHub + CI, deploy Vercel Services + Neon (ADR 011), migrate + seed production, `trust proxy`, log kèm request id | URL public đăng nhập được; CI xanh trên `main` | ✅ |
| M1.1 | `core`: Zod schema template + `validateTemplate` | Unit test BR-T04…T11 pass | ✅ |
| M1.2 | `core`: `today`, `addDays`, availability + overdue, `planActivation` | Unit test BR-A04, A06, A08, E01, E06, R01… pass | ✅ |
| M1.3 | API template (8 endpoint chỉ HR), seed Engineering v1 + v2 và General, audit | AT-01…AT-04, AT-06 (phần publish), BR-T02 pass | ✅ |
| M1.4a | API draft onboarding: 3 bảng, `GET /employees`, `GET /departments`, tạo và sửa draft, xem theo phạm vi | AT-11, BR-T12 (phần tạo), BR-P01, P02 pass | ✅ |
| M1.4b | API onboarding: `today(org)`, activation preview, activate; task trong `GET /onboardings/:id`; xem onboarding qua task được giao (mọi vai) | AT-05, AT-06 (phần activate), AT-07…AT-10 (A10 phần activate), BR-T12 pass | ✅ |
| **M1.5** | API task: `start`/`complete` checklist (khóa theo onboarding, §6.4), BR-E01, onboarding tự COMPLETED, `GET /tasks/mine`, `POST /demo/clock/advance` (chỉ sandbox, chỉ tiến; chưa có tick) | AT-12…AT-14, AT-23, AT-31 (phần đồng hồ) pass | ▶ |
| M1.6 | Web: TanStack Query, danh sách onboarding, wizard (nhân viên → template + ngày → preview + chọn, override assignee → activate; canvas chưa có override: làm bản trước/sau) | Activate template seed qua UI; khớp màn NewOnboarding | ⏳ |
| M1.7 | Web: onboarding detail (task theo phase, badge availability) + My Tasks | IT và Manager complete checklist qua UI; khóa theo ngày/dependency đúng; onboarding tự COMPLETED | ⏳ |
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
pnpm exec playwright-cli -s=joinpath open http://localhost:3000/login   # Chrome có cửa sổ để kiểm tra UI; `show` mở dashboard xem trực tiếp
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
- oxlint không in gì khi chạy trong Claude Code mà không có lỗi; thêm `--format=default` để thấy tổng kết.
- Prisma 7.10 (pin; npm `latest` là 8.0 RC, bỏ qua banner update): không tự đọc `.env` (config dùng `process.loadEnvFile()`); `migrate dev` không tự `generate` hay seed; `migrate reset` bị Prisma chặn khi chạy từ AI agent, phải hỏi user. Docs: đọc trang `/v7/`, trang không ghi version đã là Prisma 8. Partial unique (preview `partialIndexes`): đừng `findUnique` theo riêng cột đó; điều kiện `IN` viết `raw(...)` đúng chữ Postgres lưu (`= ANY (ARRAY[...])`), không thì `migrate diff` báo drift.
- psql 16 trên Windows: option phải đứng trước connection string.
- Node trên Windows bỏ qua biến `TZ`. Muốn thử code ngày với timezone có DST thì đặt `TZ` rồi chạy trên Linux (container hoặc CI).
- Kiểm tra UI bằng Playwright CLI (headed), không dùng Claude in Chrome (Chrome của extension ở máy khác). `open` không tự trả về trong Bash tool: ghi output ra file (`> .playwright-cli/cmd.log 2>&1`); `--filename` tính từ thư mục hiện tại.
- Script Python sửa file repo: đọc, ghi với `newline=""` (không thì thành CRLF); in output vitest cần `PYTHONIOENCODING=utf-8`.
- Sửa `packages/core` khi `pnpm dev` đang chạy: web có thể giữ bản core cũ, nên build core rồi restart `pnpm dev`.
- Vercel CLI 62.2.0 (global, đã đăng nhập; hook đầu session báo "not installed" là sai). MCP Vercel trả 403 với team này: dùng `vercel api`, `vercel logs`, `vercel inspect --logs`. Không chạy `vercel deploy` từ máy (CLI upload cả `apps/api/.env`).
- Secret không bao giờ in ra transcript. Đặt secret qua file tạm trong scratchpad rồi xóa ngay, hoặc để user tự gõ trong terminal riêng.
- Neon (Postgres 18.6) ngủ sau 5 phút không có truy vấn; request đầu tiên khi đó chậm thêm khoảng 0,9 s.
