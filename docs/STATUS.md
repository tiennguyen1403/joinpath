# Trạng thái dự án

> File này được nạp vào mọi session qua `CLAUDE.md`. Giữ ngắn: chỉ trạng thái hiện tại. Lịch sử chi tiết nằm trong `docs/sessions/`.

**Cập nhật:** 2026-10-16 · session 023 (M3.1a · Đổi ngày, hủy, reassign, deadline: API)
**Mốc hiện tại:** M3 · Vận hành và demo, xong 1/8 session.

M0, M1, M2 đã xong; demo public tại https://joinpath.vercel.app, đã push tới M2.4b (commit `M2.5`, `M3.1a` còn ở local). Golden path (PLAN §11) bước 2–9 chạy trọn ở local qua UI (M2.5). M3.1a: API đổi ngày, hủy, reassign, override deadline; chưa có UI.

**Session kế tiếp:** **M3.1b · Web cho 4 thao tác đó ở onboarding detail** (xem bảng). Bước đầu: đọc canvas phần OnboardingDetail (nút header, menu ⋯, dialog). Handoff mới nhất: `docs/sessions/023-M3.1a-hr-changes-api.md`; dữ liệu đọc từ canvas nằm ở handoff 005, 008, 009, 016 và 019.

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
| M2.1a | API lời mời: bảng `invitations`, `mock_emails`; activate gửi lời mời; tra cứu và nhận lời mời, resend, `GET /mock-inbox` | AT-10 (phần invitation), AT-30, AT-32 pass; có throttle khi tra cứu và nhận lời mời | ✅ |
| M2.1b | Web: Mock inbox, trang nhận lời mời, khung Invitation (Resend) ở detail, dòng lời mời ở wizard và toast | Qua UI: HR activate → mở email → đặt mật khẩu → An đăng nhập, thấy task của mình; sau Resend, link cũ hết hiệu lực | ✅ |
| M2.2 | RustFS (compose + CI), upload (magic bytes, 4 MB, 5 file), xóa file chưa submit, signed download, need-to-know | AT-26, AT-27, AT-29 pass; lần upload đầu chuyển DOCUMENT sang IN_PROGRESS | ✅ |
| M2.3 | Submit revision, approve / reject / rework | AT-15…AT-18 pass (AT-19 cần reassign, M3.1); AT-13 bỏ đoạn đánh dấu bằng Prisma | ✅ |
| M2.4a | Web: portal nhân viên mới, upload, submit, lịch sử duyệt | An upload, submit qua UI ở 390 px và desktop | ✅ |
| M2.4b | Web: drawer review (xem file), approve / reject kèm lý do; nút cho DOCUMENT, APPROVAL trong My Tasks | Qua UI: Lan reject → An nộp revision 2 → Lan approve | ✅ |
| M2.5 | Golden path ở local, rà nhóm test P, push | Golden path bước 2–9 chạy trọn ở local (đăng nhập từng vai thay cho đổi vai, tua ngày bằng API); nhóm R, P pass | ✅ |
| M3.1a | API: `planReschedule` trong `core`; reschedule, cancel, reassign, due-date; lệnh trên task kiểm lại assignee sau khi khóa | AT-06 (phần cancel), AT-19, AT-20 (dời muộn và dời sớm), AT-21, AT-22 pass; có test BR-S03, BR-S04 | ✅ |
| **M3.1b** | Web: Change start date, Cancel onboarding ở header của detail; nút ⋯ trên dòng task (reassign, đổi và reset deadline); badge Canceled, Next step trống; nhãn riêng ở khung Invitation khi hủy | Qua UI, HR làm đủ 4 thao tác; khớp canvas | ▶ |
| M3.2a | API: `notifications`, `notify(tx)` cho các sự kiện BR-N02 (submit, reject kèm lý do, approve, reassign, đổi deadline, hủy…); cron tick (due-soon, overdue, READY theo ngày, dọn session và lời mời hết hạn); tua ngày chạy tick (BR-D03); chốt người gọi cron | AT-24, AT-25 pass; mỗi sự kiện có test | ⏳ |
| M3.2b | Web: chuông và danh sách thông báo (app shell và header của portal), "N overdue" ở sidebar, các email mới trong mock inbox | Qua UI, mỗi vai thấy thông báo của mình và đánh dấu đã đọc | ⏳ |
| M3.3a | API sandbox: `POST /demo/sandboxes` (throttle theo IP hash lưu trong DB), `scenarios` A/B/C của seed (PLAN §11; A để start ≤ hôm nay + 5), purge sandbox hết hạn, `switch-user`; ngày "Finished" theo ngày nghiệp vụ (handoff 022) | AT-31 (phần đổi vai) pass; có test BR-D01, BR-P06 (phần sandbox) | ⏳ |
| M3.3b | Web: Dynamic Island (đổi vai, ngày nghiệp vụ, +1 ngày, tới ngày bắt đầu, demo mới, inbox), cả trên portal; nút Try demo; đường từ portal sang My tasks cho người đã xong onboarding (handoff 020) | Golden path bước 1–9 chạy ở local chỉ bằng UI | ⏳ |
| M3.4 | Dashboard HR + tab Activity (`GET /dashboard`, `GET /onboardings/:id/activity`); có thể tách a/b | Golden path bước 10 ở local | ⏳ |
| M3.5 | Demo public end-to-end trên host; upload và xem file thật trên production (hoãn từ M2.5) | **Mốc an toàn:** golden path 1–10 chạy trên production | ⏳ |
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
- Preview deployment: origin khác `APP_ORIGIN` nên mọi request ghi bị 403, preview dùng chung DB với production, và không có `S3_*` (chỉ đặt cho Production) nên API của preview không boot. Chốt khi bắt đầu dùng PR: tắt preview, hoặc cho phép origin của preview và dùng Neon branch.
- Swagger `/api/docs` (PLAN §8) chưa thuộc session nào; khi thêm phải chỉnh CSP của `helmet`. Gắn vào session nào?
- BR-R01 ở mức template: M1.4a chốt không thêm rule chặn publish. Còn mở cho M4.1: editor có gợi ý (không chặn) khi DOCUMENT và APPROVAL của nó cùng giao `DIRECT_MANAGER` không?
- Nút "Discard draft" (canvas, editor) cần xóa DRAFT, trái PLAN §7 (không xóa bản ghi nghiệp vụ) và §8 (không có endpoint): chốt ở M4.1.
- Ai thấy lý do hủy (`cancel_reason`, API chưa trả): chỉ HR hay mọi người xem được onboarding. Chốt ở M3.1b theo canvas.

## Chạy dự án

```sh
pnpm install
docker compose up -d   # Postgres 18 ở localhost:5433 (user/pass/db: joinpath), RustFS (S3) ở localhost:9000
cp apps/api/.env.example apps/api/.env   # lần đầu: DATABASE_URL, APP_ORIGIN, SEED_PASSWORD, S3_*
pnpm build             # core/dist + client Prisma (src/generated) + dist của api; test, typecheck, lint cần nó
pnpm storage:init      # lần đầu, hoặc volume RustFS mới: tạo bucket joinpath (test và upload cần nó)
pnpm db:migrate        # prisma migrate dev (lần đầu, hoặc khi đổi schema)
pnpm db:seed           # tạo lại org acme: lan.pham@acme.joinpath.demo (HR), duc.tran@… (IT), minh.nguyen@… (MEMBER)
pnpm dev               # web http://localhost:3000 (đăng nhập ở /login; thư mời ở /mock-inbox; portal của người mới ở /my-onboarding; duyệt tài liệu ở /tasks, nút Review documents) · api http://localhost:3001/api/health
pnpm test              # cần Postgres + migration, RustFS + bucket; rồi pnpm lint · pnpm typecheck · pnpm format:check
# Tua ngày nghiệp vụ: POST /api/demo/clock/advance {days} (1–30, org sandbox; acme là sandbox), chưa có UI (M3.3). Đưa đồng hồ local về hôm nay:
docker compose exec -T postgres psql -U joinpath -d joinpath -c "UPDATE organizations SET clock_offset_days = 0 WHERE slug = 'acme'"
pnpm exec playwright-cli -s=joinpath open http://localhost:3000/login   # Chrome có cửa sổ; `show` mở dashboard xem trực tiếp
```

Production: https://joinpath.vercel.app (Vercel Services + Neon Singapore, ADR 011; storage Cloudflare R2, bucket `joinpath`, location hint APAC).

```sh
git push origin main          # chạy CI và deploy production; migrate chạy trong bước build
gh workflow run seed.yml      # tạo lại org acme trên prod, xóa sạch dữ liệu cũ của org; mật khẩu là secret SEED_PASSWORD
vercel logs <deployment-url> --since 1h   # log runtime: mỗi request API một dòng, kèm IP và request id
```

Env trên Vercel:
- Tự đặt: `APP_ORIGIN`, `TRUST_PROXY_HOPS=1`, `ENABLE_EXPERIMENTAL_COREPACK=1`.
- Integration Neon cấp: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.
- Storage R2 (M2.5), chỉ Production, loại Secret (không đọc lại được): `S3_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `S3_REGION=auto`, `S3_BUCKET=joinpath`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (token Object Read & Write, chỉ bucket `joinpath`). Thiếu thì API không boot.

Secret của repo GitHub: `DATABASE_URL` (giá trị unpooled), `SEED_PASSWORD`.

Web đọc `API_URL` (`apps/web/.env.example`). Thêm component beUI: `cd apps/web && pnpm dlx shadcn@4.21.5 add https://beui.dev/r/<slug>.json`, rồi làm theo `apps/web/components/beui/README.md`.

Môi trường máy dev và các bẫy của công cụ: `docs/ENVIRONMENT.md` (cũng nạp qua `CLAUDE.md`).
