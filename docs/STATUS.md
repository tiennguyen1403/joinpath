# Trạng thái dự án

> File này được nạp vào mọi session qua `CLAUDE.md`. Giữ ngắn: chỉ trạng thái hiện tại. Lịch sử chi tiết nằm trong `docs/sessions/`.

**Cập nhật:** 2026-10-17 · session 040 (M4.4 · Analytics theo phòng ban + rà FR mức Must)
**Mốc hiện tại:** M5 · Hoàn thiện, 0/4 session. M4 xong sau 7 session: MVP cut line đạt ở local (đủ 26/26 FR mức Must, bảng bằng chứng ở handoff 040), lên prod khi push.

M0–M4 đã xong. Demo public tại https://joinpath.vercel.app, đã push tới M3.4b (`a254d2d`); golden path (PLAN §11) bước 1–10 chạy trên production chỉ bằng UI (M3.5): đổi ngày, hủy, reassign, đổi deadline; thông báo trong app và email; Vercel Cron tick mỗi ngày 01:00 UTC (`CRON_SECRET` đã đặt); sandbox 24 giờ kèm A, B, C, purge cả file trên R2; mốc giờ theo ngày nghiệp vụ; Dynamic Island; dashboard HR và Activity. Chỉ ở local (chưa push): template editor (M4.1a–M4.2b: sửa task và cấu trúc, validate tức thì, tự lưu, version, Publish, Discard, Archive); dependency graph ở trang onboarding và trang template (M4.3a–M4.3b); khối Onboardings by department trên dashboard (M4.4, FR-24).

**Session kế tiếp:** **M5.1 · Playwright: golden path + quyền xem file**. Bước đầu: user push (`! git push origin main`: M4.1a–M4.4, không migration), rồi kiểm trên prod khối By department, editor và graph; kiểm cron nếu mở session trong 01:00–02:00 UTC (log Vercel chỉ giữ khoảng 1 giờ; chưa kiểm từ handoff 033); chi tiết hóa M5 (session đầu của mốc) trước khi code. Handoff mới nhất: `docs/sessions/040-M4.4-analytics-by-department.md`.

## Quy ước session

- Mỗi session = một lát cắt kiểm chứng được, có tiêu chí "xong khi". Xong thì đóng session, kể cả khi xong sớm.
- Session đầu của mỗi mốc M1–M5 chi tiết hóa lại các session của mốc đó (sửa bảng dưới) trước khi code.

## Bảng session

Trạng thái: ✅ xong · ▶ kế tiếp · ⏳ chưa làm. Mốc M5 mới ở mức khung.

| ID | Nội dung | Xong khi | TT |
|---|---|---|---|
| S0 | Kế hoạch, canvas 15 bảng, khung handoff | Có PLAN, canvas, STATUS | ✅ |
| M0.1–M0.4 | Walking skeleton: khung repo, Prisma + đăng nhập bằng cookie session, web shell (beUI, reicon), CI + deploy Vercel Services + Neon | URL public đăng nhập được; CI xanh (handoff 001–004) | ✅ |
| M1.1–M1.9 | Workflow engine: `core` (validate template, ngày, availability, `planActivation`); API template, onboarding, task, employees; web Onboardings, wizard, detail, My Tasks, Employees, Templates | Tiêu chí M1 (PLAN §13) đạt trên production; nhóm test T, A, E pass (handoff 005–015) | ✅ |
| M2.1a–M2.5 | Tài liệu và duyệt: lời mời, mock inbox, resend; RustFS, upload (magic bytes, 4 MB, 5 file), signed download, need-to-know; submit, approve / reject / rework; web: nhận lời mời, portal người mới, drawer review | Golden path bước 2–9 chạy trọn ở local qua UI; nhóm test R, P pass (handoff 016–022) | ✅ |
| M3.1a–M3.2b | Đổi ngày bắt đầu, hủy, reassign, đổi deadline (`planReschedule` trong `core`, API, web); thông báo trong app và email, cron tick, trang Notifications và chuông trên portal | AT-06, AT-19–AT-22, AT-24, AT-25 pass; qua UI mỗi vai làm được việc của mình (handoff 023–026) | ✅ |
| M3.3a–M3.3d | Sandbox (`POST /demo/sandboxes`, scenarios A/B/C, purge, `switch-user`); mốc giờ theo ngày nghiệp vụ (`clock_advances`); Dynamic Island trên mọi trang của sandbox, cả 390 px; Try demo; notice dữ liệu giả; portal → My tasks | AT-31, BR-D01, BR-D05, BR-P06 pass; golden path bước 1–9 chạy ở local chỉ bằng UI (handoff 027–030) | ✅ |
| M3.4a–M3.4b | API `GET /dashboard`, `GET /onboardings/:id/activity` (từ `audit_events`), schema và `blockersOf` trong `core`; web: dashboard HR, Activity là card ở cột phải trang chi tiết | Test FR-19 pass; golden path bước 10 ở local (handoff 031–032) | ✅ |
| M3.5 | Push, demo public end-to-end; upload và xem file thật trên production; `CRON_SECRET`, Vercel Cron với Services; thời gian tạo sandbox, purge với R2 | **Mốc an toàn:** golden path 1–10 chạy trên production (handoff 033) | ✅ |
| M4.1a–M4.4 | Template editor (sửa task và cấu trúc, validate tức thì bằng `core`, tự lưu, tab version, Publish, Discard, Archive); dependency graph (React Flow + dagre, Vitest cho `apps/web`) ở trang onboarding và template; rà FR mức Must; khối Onboardings by department trên dashboard (FR-24) | **MVP cut line** ở local: đủ 26/26 FR mức Must; test FR-23, FR-24, BR-T05, BR-T09 pass; 1440, 1024, 390 px không tràn ngang (handoff 034–040) | ✅ |
| **M5.1** | Playwright: golden path + quyền xem file | | ▶ |
| M5.2 | Rà ma trận quyền, cross-tenant, upload; trạng thái rỗng và lỗi; a11y | | ⏳ |
| M5.3 | Checklist hướng dẫn demo + landing page | | ⏳ |
| M5.4 | README, ADR, sơ đồ, kịch bản video | Sẵn sàng đưa vào portfolio | ⏳ |

## Quyết định còn mở

- Preview deployment: origin khác `APP_ORIGIN` nên mọi request ghi bị 403, preview dùng chung DB với production, và không có `S3_*` (chỉ đặt cho Production) nên API của preview không boot. Chốt khi bắt đầu dùng PR: tắt preview, hoặc cho phép origin của preview và dùng Neon branch.
- Swagger `/api/docs` (PLAN §8) chưa thuộc session nào; khi thêm phải chỉnh CSP của `helmet`. Gắn vào session nào?
- Dòng "React Flow" trên graph hiện nhưng không bấm được, vì cả khung graph `inert` (để vuốt cuộn được trang và trình đọc màn hình bỏ qua graph). Muốn link bấm được thì phải bỏ `inert` khỏi riêng panel đó: chốt ở M5.2?
- Khung `DashboardInUse` trên canvas chính cao 1660 px, nội dung đo được 1735 px (cắt khoảng 75 px cuối của Recent activity). Sửa `h` của khung đó không? (skill session-end không cho tự sửa bảng cũ; M4.4)

## Chạy dự án

```sh
pnpm install
docker compose up -d   # Postgres 18 ở localhost:5433 (user/pass/db: joinpath), RustFS (S3) ở localhost:9000
cp apps/api/.env.example apps/api/.env   # lần đầu: DATABASE_URL, APP_ORIGIN, SEED_PASSWORD, S3_*
pnpm build             # core/dist + client Prisma (src/generated) + dist của api; test, typecheck, lint cần nó
pnpm storage:init      # lần đầu, hoặc volume RustFS mới: tạo bucket joinpath (test và upload cần nó)
pnpm db:migrate        # prisma migrate dev (lần đầu, hoặc khi đổi schema)
pnpm db:seed           # tạo lại org acme: lan.pham@acme.joinpath.demo (HR), duc.tran@… (IT), minh.nguyen@… (MEMBER), kèm onboarding
                       # A (An, nháp), B (Bao, chờ Lan duyệt ID), C (Chi, đã xong); cần RustFS + bucket. --no-scenarios: chỉ người và template
pnpm dev               # web http://localhost:3000 (đăng nhập ở /login; thư mời ở /mock-inbox; portal của người mới ở /my-onboarding; duyệt tài liệu ở /tasks, nút Review documents; thông báo ở /notifications; sửa, publish, discard, archive (nút ⋯) template: bấm một dòng ở /templates, New template ở đó; graph: tab Graph ở trang chi tiết onboarding và trang template; analytics: khối Onboardings by department ở /dashboard) · api http://localhost:3001/api/health
pnpm test              # cần Postgres + migration, RustFS + bucket; rồi pnpm lint · pnpm typecheck · pnpm format:check
# Tua ngày: +1 day, Jump trên island (mọi trang trong sandbox, cả portal và mock inbox), hoặc POST /api/demo/clock/advance {days} (1–30, chỉ sandbox; acme là sandbox); ghi clock_advances rồi chạy tick.
# Try demo: "Start a demo instead" ở /login (5 sandbox mỗi giờ mỗi IP; IP local là ::1). Đổi vai: island, hoặc POST /api/demo/switch-user {employeeId}, cả trong acme.
# Tick mọi org bằng tay: đặt CRON_SECRET trong apps/api/.env rồi curl -H "Authorization: Bearer <secret>" http://localhost:3001/api/internal/cron/tick
# Đưa đồng hồ local về hôm nay (xóa luôn lịch sử tua ngày, không thì mốc giờ còn dời):
docker compose exec -T postgres psql -U joinpath -d joinpath -c "UPDATE organizations SET clock_offset_days = 0 WHERE slug = 'acme'; DELETE FROM clock_advances WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'acme')"
pnpm exec playwright-cli -s=joinpath open http://localhost:3000/login   # Chrome có cửa sổ; `show` mở dashboard xem trực tiếp
```

Production: https://joinpath.vercel.app (Vercel Services + Neon Singapore, ADR 011; storage Cloudflare R2, bucket `joinpath`, location hint APAC).

```sh
git push origin main          # chạy CI và deploy production; migrate chạy trong bước build
gh workflow run seed.yml      # tạo lại org acme trên prod (không kèm A/B/C), xóa sạch dữ liệu cũ của org; mật khẩu là secret SEED_PASSWORD
vercel logs <deployment-url> --since 1h   # log runtime: mỗi request API một dòng, kèm IP và request id
vercel crons list             # cron đã đăng ký; chạy tick prod ngay: user tự gõ ! MSYS_NO_PATHCONV=1 vercel crons run /api/internal/cron/tick
```

Env trên Vercel:
- Tự đặt: `APP_ORIGIN`, `TRUST_PROXY_HOPS=1`, `ENABLE_EXPERIMENTAL_COREPACK=1`.
- Integration Neon cấp: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.
- Storage R2 (M2.5), chỉ Production, loại Secret (không đọc lại được): `S3_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `S3_REGION=auto`, `S3_BUCKET=joinpath`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (token Object Read & Write, chỉ bucket `joinpath`). Thiếu thì API không boot.
- `CRON_SECRET`, Production, loại Secret: đặt ở M3.5, 64 ký tự hex ngẫu nhiên, không ai giữ bản sao (đổi thì đặt lại với `--force`). Vercel Cron gửi nó khi gọi `/api/internal/cron/tick` mỗi ngày (`vercel.json`); thiếu thì API vẫn boot, route trả 401.

Secret của repo GitHub: `DATABASE_URL` (giá trị unpooled), `SEED_PASSWORD`.

Web đọc `API_URL` (`apps/web/.env.example`). Thêm component beUI: `cd apps/web && pnpm dlx shadcn@4.21.5 add https://beui.dev/r/<slug>.json`, rồi làm theo `apps/web/components/beui/README.md`.

Môi trường máy dev và các bẫy của công cụ: `docs/ENVIRONMENT.md` (cũng nạp qua `CLAUDE.md`).
