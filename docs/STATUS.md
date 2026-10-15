# Trạng thái dự án

> File này được nạp vào mọi session qua `CLAUDE.md`. Giữ ngắn: chỉ trạng thái hiện tại. Lịch sử chi tiết nằm trong `docs/sessions/`.

**Cập nhật:** 2026-10-15 · session 004 (M0.4 · CI + host + deploy)
**Mốc hiện tại:** M1 · Workflow engine, chưa bắt đầu. M0 · Walking skeleton đã xong, gồm:
- Khung repo, Prisma (5 bảng), seed org `acme`.
- Auth API: cookie session, Origin check, throttle, helmet.
- Web shell: trang login, sidebar theo vai trò.
- CI trên GitHub Actions.
- Demo public tại https://joinpath.vercel.app (Vercel Services + Neon, ADR 011).

**Session kế tiếp:** **M1.1 · `core`: schema template + `validateTemplate`** (xem bảng). Đây là session đầu của M1, nên phải chi tiết hóa lại các dòng M1.x trước khi code. Handoff mới nhất: `docs/sessions/004-M0.4-ci-host-deploy.md`.

## Quy ước session

- Mỗi session = một lát cắt kiểm chứng được, có tiêu chí "xong khi". Xong thì đóng session, kể cả khi xong sớm.
- Việc lớn hơn dự kiến, hoặc user thấy `/context` đã quá nửa (user là người theo dõi mức context): dừng ở điểm sạch, ghi phần dở vào handoff, tách thành M?.?a / M?.?b.
- File handoff: `docs/sessions/NNN-<ID>-<slug>.md` (NNN tăng dần toàn dự án, theo `docs/sessions/TEMPLATE.md`).
- Session đầu của mỗi mốc M1–M5 chi tiết hóa lại các session của mốc đó (sửa bảng dưới) trước khi code.

## Bảng session

Trạng thái: ✅ xong · ▶ kế tiếp · ⏳ chưa làm. Mốc M1–M5 mới ở mức khung.

| ID | Nội dung | Xong khi | TT |
|---|---|---|---|
| S0 | Kế hoạch (PLAN v0.9), thiết kế 15 bảng, bộ khung handoff | Có PLAN, canvas, CLAUDE.md, STATUS, template | ✅ |
| M0.1 | Khung repo: `git`, pnpm workspace (`apps/web` Next.js 16, `apps/api` NestJS 12 ESM, `packages/core` TS + Zod + Vitest), TS 6.0 pin, oxlint, `docker-compose.yml` Postgres 18, script gốc `dev/build/test/lint/typecheck` | `pnpm install`, `pnpm -r build`, `pnpm -r test`, lint, typecheck xanh; `docker compose up -d` Postgres healthy; `pnpm dev`: web :3000 hiện trang, api :3001 `/health` trả ok; cả web và api import được từ `core` | ✅ |
| M0.2 | Data + auth API: Prisma 7.10 pin (org, departments, employees, users, sessions), migration, `seedDemoOrg` phần nhân sự cho org cố định (§11); login / logout / me bằng cookie session (ADR 007); thêm Origin check, throttle login, helmet (§9) | Test Supertest với Postgres thật pass: login đặt cookie đúng cờ, sai mật khẩu 401 chung chung, `me` đúng user/org/role, logout vô hiệu session | ✅ |
| M0.3 | Web shell: Tailwind 4 + token beUI (kèm 3 chỗ lệch, ADR 009), component beUI qua registry, `reicon-react`, `motion` + `lib/ease.ts`, rewrite `/api/*` (kiểm tra giữ nguyên header `Origin`), trang login, layout theo vai trò (HR / IT / MEMBER) | Ở local: đăng nhập bằng user seed qua UI, thấy đúng sidebar theo vai trò, logout được; giao diện khớp bảng Login và Dashboard trên canvas | ✅ |
| M0.4 | CI + host + deploy: GitHub repo (hỏi user), GitHub Actions (lint, typecheck, test với Postgres service), đo cold start để chọn host (§6.6), deploy, migrate + seed (`SEED_PASSWORD` là secret), `trust proxy` đúng số hop để throttle login thấy IP thật (ADR 007), log kèm request id, smoke test | **Có URL public đăng nhập được bằng user seed**; CI xanh trên `main` | ✅ |
| **M1.1** | `core`: schema template + `validateTemplate` (DAG, mọi BR-T) | Unit test nhóm T pass | ▶ |
| M1.2 | `core`: tính ngày, availability, activation plan | Unit test tương ứng pass | ⏳ |
| M1.3 | API template (tạo, `PUT` JSON, publish, archive) + nhân viên CRUD tối thiểu (email lowercase khi ghi, vì unique của `users.email` phân biệt hoa thường) + audit | Integration test template pass | ⏳ |
| M1.4 | API onboarding: draft → preview → activate, checklist, business clock + endpoint tua ngày | AT-06 → AT-14 liên quan pass | ⏳ |
| M1.5 | Web: wizard tạo onboarding + onboarding detail | Activate template seed qua UI | ⏳ |
| M1.6 | Web: My Tasks; chốt tiêu chí M1 | IT và Manager làm checklist; khóa theo ngày/dependency đúng; onboarding tự COMPLETED; nhóm test T, A, E pass | ⏳ |
| M2.1 | Invitation + mock inbox + nhận lời mời + resend | | ⏳ |
| M2.2 | MinIO (compose + CI), upload (magic bytes, 4 MB), signed download, need-to-know | | ⏳ |
| M2.3 | Submit revision, approve / reject / rework | Nhóm test R pass | ⏳ |
| M2.4 | Web: portal nhân viên mới, upload, drawer review | | ⏳ |
| M2.5 | Chạy trọn golden path ở local, nhóm test P | Golden path (§11) chạy trọn ở local | ⏳ |
| M3.1 | Đổi ngày, reassign, override deadline, hủy | | ⏳ |
| M3.2 | Thông báo in-app + cron tick | | ⏳ |
| M3.3 | Sandbox mỗi khách + Dynamic Island (đổi vai, ngày nghiệp vụ) | | ⏳ |
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

Web đọc `API_URL` (mặc định `http://localhost:3001`, xem `apps/web/.env.example`). Thêm component beUI: `cd apps/web && pnpm dlx shadcn@4.21.5 add https://beui.dev/r/<slug>.json`, rồi làm theo `apps/web/components/beui/README.md`.

## Môi trường đã biết

- Windows 11, PowerShell 5.1 + Git Bash. Git 2.41 (`core.autocrlf=true` ở mức system → repo dùng `.gitattributes` `eol=lf`).
- Đã kiểm tra lúc đóng S0: Node v24.21.0, pnpm 12.11.2 (global), Docker 29.5.3 (engine đang chạy).
- Postgres 16 cài sẵn trên Windows chiếm port 5432, nên Postgres của dự án (Docker) chạy ở 5433.
- oxlint không in gì khi chạy trong Claude Code mà không có lỗi; thêm `--format=default` để thấy tổng kết.
- Prisma 7.10 (pin; npm `latest` là 8.0 RC, bỏ qua banner update): không tự đọc `.env` (config dùng `process.loadEnvFile()`); `migrate dev` không tự `generate` hay seed; `migrate reset` bị Prisma chặn khi chạy từ AI agent, phải hỏi user. Docs: đọc trang `/v7/`, trang không ghi version đã là Prisma 8.
- psql 16 trên Windows: option phải đứng trước connection string.
- Kiểm tra UI bằng Playwright CLI (headed), không dùng Claude in Chrome: Chrome của extension nằm ở máy khác. Lệnh `open` không tự trả về trong Bash tool, nên ghi output ra file (`> .playwright-cli/cmd.log 2>&1`); `--filename` tính từ thư mục hiện tại.
- Sửa `packages/core` khi `pnpm dev` đang chạy: web có thể giữ bản core cũ, nên build core rồi restart `pnpm dev`.
- Thiết kế: canvas "Joinpath Screens" https://claude.ai/artifact/Xr3pRZbd14D78pqUignjWV (đọc bằng Artifact tool, action `read`).
- Vercel CLI 62.2.0 cài global, đã đăng nhập. Hook đầu session báo "not installed" là sai.
  - MCP Vercel trả 403 với team này, nên dùng CLI: `vercel api`, `vercel logs`, `vercel inspect --logs`.
  - Không chạy `vercel deploy` từ máy, vì CLI sẽ upload cả `apps/api/.env`.
- Secret không bao giờ in ra transcript. Đặt secret qua file tạm trong scratchpad rồi xóa ngay, hoặc để user tự gõ trong terminal riêng.
- Neon (Postgres 18.6) ngủ sau 5 phút không có truy vấn; request đầu tiên khi đó chậm thêm khoảng 0,9 s.
