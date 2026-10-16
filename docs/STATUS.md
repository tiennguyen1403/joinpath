# Trạng thái dự án

> File này được nạp vào mọi session qua `CLAUDE.md`. Giữ ngắn: chỉ trạng thái hiện tại. Lịch sử chi tiết nằm trong `docs/sessions/`.

**Cập nhật:** 2026-10-16 · session 028 (M3.3b · API mốc giờ theo ngày nghiệp vụ)
**Mốc hiện tại:** M3 · Vận hành và demo, xong 6/9 session.

M0, M1, M2 đã xong; demo public tại https://joinpath.vercel.app, đã push tới M2.4b (commit `M2.5`, `M3.1a`, `M3.1b`, `M3.2a`, `M3.2b`, `M3.3a`, `M3.3b` còn ở local). Golden path (PLAN §11) bước 2–9 chạy trọn ở local qua UI (M2.5). M3.1: HR đổi ngày bắt đầu, hủy, reassign, đổi deadline qua UI; lý do hủy chỉ HR thấy. M3.2: thông báo trong app và email cho các sự kiện BR-N02 (người nhận ở PLAN §6.5); tick nhắc việc chạy khi tua ngày và mỗi ngày qua Vercel Cron (chưa có trên prod); trang Notifications (số chưa đọc ở sidebar, "N overdue" cạnh My tasks) và chuông trên portal. M3.3a (chỉ API, chưa có UI): `POST /demo/sandboxes` tạo sandbox riêng 24 giờ kèm onboarding A, B, C chạy bằng handler thật; `switch-user`; purge sandbox hết hạn. M3.3b: mốc giờ API trả về theo ngày nghiệp vụ (BR-D05, bảng `clock_advances`).

**Session kế tiếp:** **M3.3c · Web: Dynamic Island và Try demo** (xem bảng). Bước đầu: đề xuất shape API cho danh sách người để đổi vai và hạn của sandbox, cùng trạng thái chip của người chưa có tài khoản, cho user duyệt; cân nhắc tách a/b. Handoff mới nhất: `docs/sessions/028-M3.3b-business-timestamps.md`; dữ liệu đọc từ canvas nằm ở handoff 005, 008, 009, 016, 019, 025 và 027 (island, Try demo).

## Quy ước session

- Mỗi session = một lát cắt kiểm chứng được, có tiêu chí "xong khi". Xong thì đóng session, kể cả khi xong sớm.
- Session đầu của mỗi mốc M1–M5 chi tiết hóa lại các session của mốc đó (sửa bảng dưới) trước khi code.

## Bảng session

Trạng thái: ✅ xong · ▶ kế tiếp · ⏳ chưa làm. Mốc M4–M5 mới ở mức khung.

| ID | Nội dung | Xong khi | TT |
|---|---|---|---|
| S0 | Kế hoạch, canvas 15 bảng, khung handoff | Có PLAN, canvas, STATUS | ✅ |
| M0.1–M0.4 | Walking skeleton: khung repo, Prisma + đăng nhập bằng cookie session, web shell (beUI, reicon), CI + deploy Vercel Services + Neon | URL public đăng nhập được; CI xanh (handoff 001–004) | ✅ |
| M1.1–M1.9 | Workflow engine: `core` (validate template, ngày, availability, `planActivation`); API template, onboarding, task, employees; web Onboardings, wizard, detail, My Tasks, Employees, Templates | Tiêu chí M1 (PLAN §13) đạt trên production; nhóm test T, A, E pass (handoff 005–015) | ✅ |
| M2.1a–M2.5 | Tài liệu và duyệt: lời mời, mock inbox, resend; RustFS, upload (magic bytes, 4 MB, 5 file), signed download, need-to-know; submit, approve / reject / rework; web: nhận lời mời, portal người mới, drawer review | Golden path bước 2–9 chạy trọn ở local qua UI; nhóm test R, P pass (handoff 016–022) | ✅ |
| M3.1a | API: `planReschedule` trong `core`; reschedule, cancel, reassign, due-date; lệnh trên task kiểm lại assignee sau khi khóa | AT-06 (phần cancel), AT-19, AT-20 (dời muộn và dời sớm), AT-21, AT-22 pass; có test BR-S03, BR-S04 | ✅ |
| M3.1b | Web: Change start date, Cancel onboarding ở header của detail; nút ⋯ trên dòng task (reassign, đổi và reset deadline); badge Canceled, Next step trống; nhãn riêng ở khung Invitation khi hủy | Qua UI, HR làm đủ 4 thao tác; khớp canvas | ✅ |
| M3.2a | API: `notifications`, `notify(tx)` cho các sự kiện BR-N02; cron tick (due-soon, overdue, task mở theo ngày, xóa session hết hạn); tua ngày chạy tick (BR-D03); người gọi cron là Vercel Cron | AT-24, AT-25 pass; mỗi sự kiện có test | ✅ |
| M3.2b | Web: trang Notifications (sidebar) và chuông trên portal, "N overdue" ở sidebar, các email mới trong mock inbox | Qua UI, mỗi vai thấy thông báo của mình và đánh dấu đã đọc | ✅ |
| M3.3a | API sandbox: `POST /demo/sandboxes` (5 mỗi giờ mỗi IP hash lưu trong DB, trần 200), `scenarios` A/B/C của seed chạy bằng handler thật, purge sandbox hết hạn (cron và khi tạo sandbox), `switch-user` | AT-31 (phần đổi vai) pass; có test BR-D01, BR-P06 (phần sandbox), hình dạng scenarios | ✅ |
| M3.3b | API: mốc giờ theo ngày nghiệp vụ (PLAN §4.6): lưu lịch sử tua ngày; API trả mọi mốc giờ đã dời (Finished, done, Canceled, revision, lời mời, thông báo, email) | Sau khi tua ngày, mọi mốc giờ web hiện khớp ngày nghiệp vụ; có test ở `core` và API | ✅ |
| **M3.3c** | Web: Dynamic Island (đổi vai, ngày nghiệp vụ, +1 ngày, tới ngày bắt đầu, demo mới, inbox), cả trên portal; API cho danh sách người để đổi vai và hạn của sandbox; nút Try demo; đường từ portal sang My tasks cho người đã xong onboarding (handoff 020) | Golden path bước 1–9 chạy ở local chỉ bằng UI | ▶ |
| M3.4 | Dashboard HR + tab Activity (`GET /dashboard`, `GET /onboardings/:id/activity`); có thể tách a/b | Golden path bước 10 ở local | ⏳ |
| M3.5 | Demo public end-to-end trên host; upload và xem file thật trên production (hoãn từ M2.5); đặt `CRON_SECRET`, kiểm Vercel Cron chạy với Services (không được thì GitHub Actions, handoff 025); đo thời gian tạo sandbox, kiểm purge với R2 (token cần quyền list, handoff 027) | **Mốc an toàn:** golden path 1–10 chạy trên production | ⏳ |
| M4.1 | Template editor dạng form + validate tức thì bằng `core` | | ⏳ |
| M4.2 | Lịch sử version + luồng publish trên UI | | ⏳ |
| M4.3 | Dependency graph (React Flow + dagre) | | ⏳ |
| M4.4 | Analytics theo phòng ban + rà FR mức Must | **MVP cut line** | ⏳ |
| M5.1 | Playwright: golden path + quyền xem file | | ⏳ |
| M5.2 | Rà ma trận quyền, cross-tenant, upload; trạng thái rỗng và lỗi; a11y | | ⏳ |
| M5.3 | Checklist hướng dẫn demo + landing page | | ⏳ |
| M5.4 | README, ADR, sơ đồ, kịch bản video | Sẵn sàng đưa vào portfolio | ⏳ |

## Quyết định còn mở

- Preview deployment: origin khác `APP_ORIGIN` nên mọi request ghi bị 403, preview dùng chung DB với production, và không có `S3_*` (chỉ đặt cho Production) nên API của preview không boot. Chốt khi bắt đầu dùng PR: tắt preview, hoặc cho phép origin của preview và dùng Neon branch.
- Swagger `/api/docs` (PLAN §8) chưa thuộc session nào; khi thêm phải chỉnh CSP của `helmet`. Gắn vào session nào?
- BR-R01 ở mức template: M1.4a chốt không thêm rule chặn publish. Còn mở cho M4.1: editor có gợi ý (không chặn) khi DOCUMENT và APPROVAL của nó cùng giao `DIRECT_MANAGER` không?
- Nút "Discard draft" (canvas, editor) cần xóa DRAFT, trái PLAN §7 (không xóa bản ghi nghiệp vụ) và §8 (không có endpoint): chốt ở M4.1.

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
pnpm dev               # web http://localhost:3000 (đăng nhập ở /login; thư mời ở /mock-inbox; portal của người mới ở /my-onboarding; duyệt tài liệu ở /tasks, nút Review documents; thông báo ở /notifications) · api http://localhost:3001/api/health
pnpm test              # cần Postgres + migration, RustFS + bucket; rồi pnpm lint · pnpm typecheck · pnpm format:check
# Tua ngày nghiệp vụ: POST /api/demo/clock/advance {days} (1–30, org sandbox; acme là sandbox), ghi clock_advances (BR-D05) rồi chạy tick của org; chưa có UI (M3.3c).
# Như nút Try demo: curl -X POST http://localhost:3001/api/demo/sandboxes (sandbox mới, trả cookie của Lan). Đổi vai: POST /api/demo/switch-user {employeeId}, cả trong acme.
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
```

Env trên Vercel:
- Tự đặt: `APP_ORIGIN`, `TRUST_PROXY_HOPS=1`, `ENABLE_EXPERIMENTAL_COREPACK=1`.
- Integration Neon cấp: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.
- Storage R2 (M2.5), chỉ Production, loại Secret (không đọc lại được): `S3_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `S3_REGION=auto`, `S3_BUCKET=joinpath`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (token Object Read & Write, chỉ bucket `joinpath`). Thiếu thì API không boot.
- `CRON_SECRET` (M3.2a), Production, loại Secret: **chưa đặt**. Vercel Cron gửi nó khi gọi `/api/internal/cron/tick` mỗi ngày (`vercel.json`); thiếu thì API vẫn boot, route trả 401.

Secret của repo GitHub: `DATABASE_URL` (giá trị unpooled), `SEED_PASSWORD`.

Web đọc `API_URL` (`apps/web/.env.example`). Thêm component beUI: `cd apps/web && pnpm dlx shadcn@4.21.5 add https://beui.dev/r/<slug>.json`, rồi làm theo `apps/web/components/beui/README.md`.

Môi trường máy dev và các bẫy của công cụ: `docs/ENVIRONMENT.md` (cũng nạp qua `CLAUDE.md`).
