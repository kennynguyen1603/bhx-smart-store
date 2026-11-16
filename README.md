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

## Luồng demo xác nhận phản hồi

### Chuẩn bị dữ liệu và mã để in

Chạy `npm run db:seed` **trước mỗi buổi demo/test, hoặc ít nhất 2 ngày một lần**. Hạn dùng được tính tương đối theo ngày của cửa hàng (mặc định `Asia/Ho_Chi_Minh`); các lô FEFO demo có HSD +3 ngày khi seed và dùng được khoảng 2 ngày. Seed đặt lại nhiệm vụ demo và các trạng thái lô mẫu, nên hãy chạy trước khi bắt đầu luồng hoàn thành nhiệm vụ.

- Mở [/demo/barcodes](http://localhost:3000/demo/barcodes), chọn **BHX Nguyễn Trãi (NT-Q5)**, bấm **Xem mã vạch** rồi **In A4** ở tỷ lệ 100% để in mã EAN-13 sản phẩm.
- Mở [/demo/esl-labels](http://localhost:3000/demo/esl-labels), chọn cùng cửa hàng, bấm **Xem nhãn** rồi **In A4** để in QR ESL. Cả hai trang đều có liên kết từ trang chủ.
- Tại `/kiosk`, chọn **BHX Nguyễn Trãi**. Quét mã EAN `8934673574211` hoặc mã ESL `ESL-NT-Q5-L-02` đều mở **Sữa tươi Vinamilk 100% 1L** và bản đồ tới **L-02 · Kệ sữa tươi**. Có thể dùng camera hoặc máy quét HID gửi Enter sau mã. Mã ESL thuộc cửa hàng khác hoặc không tồn tại sẽ hiện thông báo không nhận diện được mã.

### Giá FEFO trên kiosk

1. Ngay sau seed, mở `/kiosk`, chọn **BHX Nguyễn Trãi (NT-Q5)** và tìm theo tên hoặc SKU trong bảng. GREENS/BREAD đã có lô `MARKED_DOWN`, giảm 20%, HSD +3 ngày; không cần hoàn thành task để thấy giá giảm.

   | SKU · Sản phẩm | Giá hiện tại | Giá gốc gạch ngang | Nhãn giảm |
   |---|---:|---:|---|
   | `GREENS-500` · Cải xanh VietGAP gói 500g | 14.320 ₫ | 17.900 ₫ | Giảm 20% |
   | `BREAD-300` · Bánh mì sandwich lúa mạch 300g | 22.800 ₫ | 28.500 ₫ | Giảm 20% |

2. Kiểm tra cùng giá hiện tại, giá gốc gạch ngang và nhãn giảm trên thẻ kết quả lẫn chi tiết. **MILK-1L · Sữa tươi Vinamilk 100% 1L** vẫn có giá thường **32.600 ₫**, không có giá gạch ngang/nhãn giảm.
3. Giá công khai lấy từ **lô hợp lệ có hạn dùng gần nhất**. Lô đó chưa giảm thì hiển thị giá thường dù lô muộn hơn có giảm giá. Bỏ qua lô cách ly, `SOLD_OUT`, số lượng ≤0, và lô đã tới hoặc quá ngày HSD theo múi giờ cửa hàng; không còn lô hợp lệ thì dùng giá cơ sở. APPLE có lô sớm hơn `SOLD_OUT`/số lượng 0; CHEESE có lô quá hạn chưa cách ly và task cách ly mở để tự thử.

### Tự hoàn thành FEFO rồi xem giá đổi

1. Sau seed, tìm **YOGURT-4 · Sữa chua Vinamilk có đường lốc 4 hộp** và **EGGS-10 · Trứng gà tươi C.P hộp 10 quả** tại kiosk NT-Q5: giá lần lượt **31.000 ₫** và **34.500 ₫**, chưa có nhãn giảm. Lô sớm nhất của mỗi sản phẩm đang `AVAILABLE`, HSD +3 ngày, có task FEFO `OPEN` tại NT-Q5; ghi chú ngày còn lại và mức giảm được tính theo luật thật lúc seed.
2. Đăng nhập `/staff` bằng `staff@demo.bhx`, chọn cửa hàng **BHX Nguyễn Trãi**, mở **Nhiệm vụ → FEFO**. Mở **Dán nhãn FEFO sữa chua** hoặc **Dán nhãn FEFO trứng gà** để xem chi tiết; bấm **Bắt đầu** để chuyển sang **Đang làm**. Kiểm tra đúng mã lô/HSD, thực hiện dán nhãn rồi bấm **Xác nhận đã dán nhãn**. Chờ thông báo **Đã áp dụng nhãn FEFO.**; Manager chỉ xem, không hoàn thành thay Staff.
3. Tải lại trang kiosk và tìm lại sản phẩm để tránh dữ liệu chi tiết đã cache trong phiên. Hoàn thành ngay sau seed áp mức 20%: YOGURT **24.800 ₫** (giá gốc **31.000 ₫**) và EGGS **27.600 ₫** (giá gốc **34.500 ₫**), kèm **Giảm 20%** ở thẻ và chi tiết.
4. Mức giảm lấy theo luật tại thời điểm hoàn thành: còn ≤3 ngày giảm 20%, còn ≤1 ngày giảm 30%; tới ngày HSD thì cách ly, không bán. Không cộng dồn phần trăm: mức bằng/thấp hơn hiện tại bị từ chối; nâng 20% lên 30% sẽ thay mức cũ.

### Quét ESL độc lập và QR demo

1. Đăng nhập `/staff`, chọn **Quét ESL**, rồi dùng camera hoặc nhập mã ESL thủ công; thao tác này không cần mở một nhiệm vụ trước.
2. ESL không có nhiệm vụ đang mở hiển thị `Không có nhiệm vụ đang mở`; có một hoặc nhiều nhiệm vụ đều giữ kết quả và QR để xem, chỉ mở chi tiết sau khi bấm **Mở nhiệm vụ** ở nhiệm vụ muốn xem.
3. Sau khi API xác nhận ESL thuộc cửa hàng được phép truy cập, màn hình hiển thị QR demo để thiết bị thứ hai quét. Payload QR chỉ chứa mã ESL ổn định, không chứa giá hoặc tồn kho.
4. Quét ESL chỉ tra cứu/mở nhiệm vụ, không tự động hoàn thành nhiệm vụ.

### Hành vi Staff và Manager

- **Staff** chỉ thấy nhiệm vụ chưa phân công hoặc được giao/đã nhận bởi chính mình; lịch sử và số liệu không lộ nhiệm vụ riêng của Staff khác. Mở nhiệm vụ hoặc kết quả ESL chỉ xem chi tiết, không đổi trạng thái hay nhận việc. Bấm **Bắt đầu** mới chuyển nhiệm vụ **Mới/Bị chặn** sang **Đang làm**; hoàn thành vẫn cần bấm nút xác nhận riêng. Khi hai Staff cùng nhận một nhiệm vụ, chỉ một người trở thành người phụ trách.
- **Manager** thấy toàn bộ nhiệm vụ của cửa hàng, gồm người phụ trách và thời điểm hoàn thành để giám sát. Giao diện Manager không cung cấp thao tác thực thi/hoàn thành nhiệm vụ thay Staff.
- **Quét ESL** là một tab ứng dụng độc lập cho cả Staff và Manager: trang nhiệm vụ được gỡ khỏi màn hình khi tab ESL hoạt động, đóng ESL trở về Tổng quan, và chọn nhiệm vụ chuyển đúng sang luồng nhiệm vụ.
- Trên màn hình di động, nút thông báo và đăng xuất có vùng chạm tối thiểu 44×44px, không co hoặc chồng lấp. Thiết lập Web Push hiển thị trạng thái chờ, chặn nhấp lặp, chỉ báo thành công sau khi máy chủ lưu đăng ký, và luôn cho phép thử lại sau lỗi.

### Giao nhiệm vụ, đồng bộ và thông báo

1. Đăng nhập `/admin` bằng Admin hoặc Manager có quyền tại cửa hàng, chọn **Nhiệm vụ → Giao nhiệm vụ**. Chọn loại **Bổ sung hàng/FEFO/Cách ly**, sản phẩm, kệ và người nhận theo tên; có thể thêm lô, độ ưu tiên, hạn và ghi chú. Để trống người nhận nếu muốn Staff trong cửa hàng tự nhận. Danh sách Admin hiển thị người phụ trách, badge trạng thái và thời điểm hoàn thành.
2. Giữ hai phiên đăng nhập riêng cho Admin và Staff. Khi Admin giao việc, Staff nhận nhiệm vụ mà không cần tải lại trang. Khi Staff bấm **Bắt đầu**, rồi xác nhận hoàn thành, Admin thấy trạng thái mới và thông báo kết quả mà không cần tải lại.
3. Staff và Admin kiểm tra dấu thay đổi mỗi **4 giây** khi tab đang hiển thị; chỉ tải lại dữ liệu khi cần đồng bộ. Vì vậy thay đổi có độ trễ khoảng vài giây, không tức thì. Tab ẩn dừng polling; khi focus hoặc hiển thị lại sẽ kiểm tra ngay.
4. Nhiệm vụ có người nhận chỉ gửi thông báo giao việc cho **Staff đang hoạt động được giao**. Chưa phân công thì gửi cho **mọi Staff đang hoạt động thuộc cửa hàng**. Khi nhiệm vụ hoàn thành hoặc bị chặn, **Manager/Admin đang hoạt động có quyền tại cửa hàng** nhận thông báo kết quả, trừ người thực hiện. Chuông trong Staff/Admin hiển thị số chưa đọc; mỗi thông báo có **Đánh dấu đã đọc**, và vẫn có **Đánh dấu tất cả đã đọc**.
5. **Web Push là tùy chọn trên từng thiết bị**: mở chuông để **Bật thông báo trên thiết bị** hoặc **Tắt thông báo trên thiết bị**. Tắt sẽ hủy đăng ký trình duyệt và xóa subscription của thiết bị trên máy chủ. Thông báo trong app và đồng bộ nhiệm vụ vẫn hoạt động khi chưa cấp/từ chối quyền trình duyệt, trình duyệt không hỗ trợ push hoặc máy chủ chưa cấu hình VAPID; lỗi push không hủy thao tác giao/hoàn thành nhiệm vụ.

### Biểu mẫu Admin và mô phỏng tích hợp

- Các thao tác tạo/sửa/xóa trong Admin dùng dialog shadcn-style dựa trên Radix, React Hook Form và Zod thay cho `prompt()`/`confirm()`. Lỗi trường hiển thị bằng tiếng Việt; dialog giữ nguyên dữ liệu khi lỗi và chỉ đóng sau khi ghi thành công.
- POS, WMS, Supplier và FEFO dùng chung trạng thái chờ: nút đang chạy có spinner cùng nhãn `Đang xử lý…`, toàn bộ nút mô phỏng bị khóa từ lúc bắt đầu ghi đến khi lần tải lại tổng quan kết thúc.
- Ghi thành công và tải lại thất bại là hai kết quả riêng. Hệ thống vẫn xác nhận thao tác đã hoàn tất, cảnh báo dữ liệu hiển thị có thể cũ, và chỉ thử lại lượt đọc nên không phát lại thao tác ghi. Mô phỏng FEFO giữ nguyên phạm vi toàn cục và chạy cho tất cả cửa hàng đang hoạt động.

### Cache/prefetch kiosk trong phiên

- Di chuột, focus hoặc chạm vào thẻ sản phẩm sẽ prefetch chi tiết và sơ đồ; lần mở tiếp theo dùng lại request đang chạy hoặc dữ liệu đã tải trong tối đa 60 giây.
- Cache sản phẩm chỉ là `Map` trong bộ nhớ của phiên kiosk hiện tại, được tách theo cửa hàng và bị xóa khi đổi cửa hàng hoặc phiên tự động reset. Request lỗi bị loại để lần thử lại có thể tải mới.
- Demo không dùng Redis, cache chia sẻ, `localStorage`, IndexedDB, SWR hoặc React Query cho tối ưu này.

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
