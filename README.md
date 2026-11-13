# BHX Smart Store

Demo full-stack cho vận hành cửa hàng thông minh, gồm ba trải nghiệm dùng chung một lớp dữ liệu PostgreSQL:

- **Staff PWA:** nhận nhiệm vụ RESTOCK/FEFO, quét ESL, làm việc offline, đồng bộ có kiểm soát phiên bản và Web Push.
- **Customer Kiosk:** tìm/quét sản phẩm, xem trạng thái còn hàng, truy xuất lô hàng và chỉ đường trên sơ đồ cửa hàng.
- **Store Admin:** quản lý hai cửa hàng demo, người dùng/RBAC, sản phẩm, nhà cung cấp, lô, tồn kho, zone/kệ, ESL, FEFO và mô phỏng tích hợp.

## Công nghệ

Next.js 16 App Router, TypeScript, PostgreSQL, Prisma 7, Auth.js Credentials, Zod, Dexie/IndexedDB, ZXing, Web Push/VAPID, Vitest và Playwright.

## Chạy local

Yêu cầu Node.js 24+ và PostgreSQL 17+ (hoặc Docker).

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000).

Nếu PostgreSQL local dùng thông tin khác, cập nhật `DATABASE_URL` trong `.env`. Tạo VAPID keys bằng:

```bash
npx web-push generate-vapid-keys --json
```

Điền public key vào `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private key vào `VAPID_PRIVATE_KEY`. Không commit `.env`.

## Tài khoản seed

| Vai trò | Email | Mật khẩu mặc định |
|---|---|---|
| Staff | `staff@demo.bhx` | `Demo@123` |
| Manager | `manager@demo.bhx` | `Demo@123` |
| Admin | `admin@demo.bhx` | `Demo@123` |

Có thể đổi mật khẩu seed bằng biến `DEMO_PASSWORD` trước khi chạy `npm run db:seed`.

## API tích hợp

Các endpoint POS/WMS/Supplier yêu cầu header `x-integration-key`. `externalEventId` là duy nhất; gửi lại cùng ID trả về kết quả cũ và không xử lý tồn kho lần hai.

```bash
curl -X POST http://localhost:3000/api/integrations/pos/sales \
  -H 'content-type: application/json' \
  -H 'x-integration-key: demo-integration-key-change-me' \
  -d '{
    "externalEventId":"pos-demo-001",
    "storeCode":"NT-Q5",
    "shelfCode":"COLD-01",
    "productSku":"MILK-1L",
    "quantity":2,
    "priceVnd":32600,
    "occurredAt":"2026-11-13T08:00:00+07:00"
  }'
```

Các nhóm API chính:

- `/api/integrations/pos/sales`, `/wms/inventory`, `/suppliers/lots`
- `/api/staff/tasks`, `/api/staff/tasks/:id/start|restock|fefo`
- `/api/esl/:code`, `/api/push/subscriptions`
- `/api/kiosk/bootstrap`, `/api/kiosk/products/search`, `/api/kiosk/products/:id`
- `/api/admin/*`, `/api/admin/simulate`
- `/api/cron/fefo` với `Authorization: Bearer $CRON_SECRET`

## Kiểm thử

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Test integration dùng PostgreSQL trong `DATABASE_URL`. Bộ test bao phủ POS idempotency, tạo task/LED, RESTOCK transaction, mutation idempotency, version conflict, FEFO không tạo task trùng, lô hết hạn cách ly, kiosk search/map và đăng nhập Staff/Admin.

GitHub Actions chạy PostgreSQL service, migration, seed, lint, typecheck, unit/integration, production build và E2E.

## Deploy Vercel + Neon

1. Tạo Neon PostgreSQL và lấy pooled `DATABASE_URL`.
2. Import repository vào Vercel và khai báo các biến trong `.env.example` bằng secret production thực.
3. Đảm bảo `NEXTAUTH_URL` là URL production; `VAPID_SUBJECT` dùng email vận hành hợp lệ.
4. Chạy migration/seed một lần từ máy quản trị:

   ```bash
   DATABASE_URL='postgresql://…' npm run db:deploy
   DATABASE_URL='postgresql://…' npm run db:seed
   ```

5. `vercel.json` chạy FEFO lúc 00:00 UTC mỗi ngày. Vercel gửi `Authorization: Bearer $CRON_SECRET` cho cron production.
6. Sau khi có URL production, thay đích chuyển hướng trong `index.html` để GitHub Pages đưa người dùng sang Vercel.

## Phạm vi demo

POS, WMS, Supplier và ESL là adapter giả lập có contract rõ ràng; chưa kết nối hạ tầng BHX thật. Bản này không bao gồm HA, pentest, tải lớn, SSO hoặc báo cáo BI nâng cao.
