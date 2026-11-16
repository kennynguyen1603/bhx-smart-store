# Thiết kế: Xử lý feedback đợt 3

Ngày: 2026-11-16 · Nguồn: `../feedback-dot3.md` (thư mục `docs/` cấp dự án)

## Mục đích và lý do

Người test bản demo BHX Smart Store (kiosk khách hàng, app nhân viên, trang quản trị) gửi 10 feedback. Mục tiêu là sửa những điểm đã được xác nhận là đúng, để:
- người test thấy được các luồng nghiệp vụ chính: giá giảm cận date, giao/nhận task hai chiều, quét mã;
- demo trông hiện đại và dễ đọc hơn;
- trang đăng nhập không lộ toàn bộ tài khoản demo.

## Kết quả kiểm tra từng mục

| # | Feedback | Kết luận | Nguyên nhân trong code |
|---|---|---|---|
| 1 | Giá giảm cận date | Đúng | Giao diện đã có `ProductPrice` (giá gạch, nhãn "Giảm x%") nhưng seed không có lô `MARKED_DOWN`. `selectPublicPrice` và query search không loại lô đã quá HSD. |
| 2 | Bấm task tự gọi API | Đúng | `openTask` trong `staff-app.tsx` tự gọi `/start` khi task OPEN/BLOCKED. Đồng bộ là polling 15 giây. |
| 3 | Thiếu badge trạng thái | Đúng | `TaskRow` chỉ hiện "Bị chặn" hoặc độ ưu tiên. |
| 4 | Admin: logout, giao task, form hiện ID | Đúng một phần | Logout có trong sidebar nhưng chỉ là icon nhỏ, không có ở mobile. Admin không tạo được task. Form hiện `CoreReadOnly label="ID"` và `storeId` thô. |
| 5 | Push không tắt được, thiếu đánh dấu đã đọc từng cái | Đúng | Nút bị disable sau khi bật, dù API `DELETE /api/push/subscriptions` đã có. PATCH notifications đã nhận `ids`, nhưng UI chỉ có "đánh dấu tất cả". |
| 6 | QR lúc có lúc không | Đúng | Trong `esl-scanner-modal.tsx`, khi ESL có đúng một task mở thì `onSelectTask` được gọi ngay nên modal chuyển sang task và QR không hiện. Với 0 hoặc nhiều hơn 1 task thì QR hiện. |
| 7 | "Bật đèn" là gì | Giải thích | Đèn LED mô phỏng trên ESL: sáng khi tồn ≤ ngưỡng (`ledOn`), tắt sau khi bổ sung hàng. Cần giải thích ngay trên UI. |
| 8 | Không có barcode demo; quét ESL ở kiosk lỗi | Lỗi phía mình | Không có trang in mã vạch sản phẩm. 13/14 mã EAN-13 trong seed **sai chữ số kiểm tra**, nên camera không thể đọc. Search kiosk không nhận mã ESL vì `searchText` không chứa nó. |
| 9 | Tách login, UI gọn và hiện đại | Đúng | Một form `/login` dùng chung, điền sẵn `staff@demo.bhx` / `Demo@123` và liệt kê mọi tài khoản demo. |
| 10 | Chữ quá nhỏ | Đúng | `globals.css` có hàng chục chỗ font 4–10px (badge 7px, eyebrow 10px, button 12px). |

## Mục tiêu

1. **Giá cận date hiển thị thật.**
   - Seed có lô giảm giá: YOGURT giảm 20%, EGGS giảm 30%, khớp với ghi chú task FEFO đang có.
   - CHEESE (đã quá hạn) chuyển sang `QUARANTINED`.
   - Có ít nhất một lô `SOLD_OUT` hoặc `quantity: 0` để minh họa trường hợp không ảnh hưởng giá.
   - Giá công khai bỏ qua lô hết hàng, quá HSD (`expiryDate < now`) hoặc bị cách ly. Không còn lô hợp lệ đang giảm thì dùng giá gốc.
   - Card và chi tiết sản phẩm ở kiosk hiện giá giảm, giá gốc gạch ngang và % giảm (component đã có, chỉ cần dữ liệu và kiểm tra hiển thị).
2. **Không tự cập nhật khi mở task.**
   - Mở task chỉ xem chi tiết.
   - Có nút "Bắt đầu" rõ ràng để chuyển sang IN_PROGRESS.
   - Các thao tác hoàn thành vẫn như hiện tại.
3. **Đồng bộ gần thời gian thực (phương án A đã chọn).**
   - Endpoint nhẹ trả "dấu thay đổi" theo cửa hàng (ví dụ `max(updatedAt)` của task cộng số thông báo chưa đọc của người dùng).
   - Client hỏi mỗi khoảng 4 giây khi tab đang mở. Có thay đổi thì tải lại danh sách. Tải lại ngay khi tab được focus hoặc visible trở lại; dừng hỏi khi tab ẩn.
   - Áp dụng cho cả app nhân viên và trang quản trị.
4. **Thông báo hai chiều.**
   - Admin hoặc quản lý giao task: nhân viên được giao (hoặc mọi nhân viên của cửa hàng nếu không chỉ định) nhận thông báo trong app và push.
   - Nhân viên hoàn thành task hoặc task bị chặn: quản lý và admin của cửa hàng nhận thông báo. Thêm `NotificationType.TASK_COMPLETED`; `TASK_BLOCKED` đã có.
   - Trang quản trị có chuông thông báo, dùng lại notification center của app nhân viên.
5. **Badge trạng thái** (shadcn `Badge`) trên mỗi task: Mới, Đang làm, Bị chặn, Hoàn thành, Đã hủy. Mỗi trạng thái một màu, và độ ưu tiên vẫn hiển thị.
6. **Admin.**
   - Nút đăng xuất có chữ, nhìn thấy rõ trên desktop lẫn mobile.
   - Form "Giao task" gồm: loại (Bổ sung hàng / FEFO / Cách ly), sản phẩm, kệ, lô (tùy chọn), người nhận (tùy chọn), độ ưu tiên, hạn, ghi chú. Sản phẩm, kệ, lô và người được chọn **theo tên**.
   - Có danh sách task của cửa hàng để theo dõi trạng thái.
   - Mọi form admin không hiện ID thô: bỏ dòng "ID", hiện tên cửa hàng thay cho `storeId`. ID vẫn được truyền và kiểm tra ở server.
7. **Thông báo.**
   - Nút push là công tắc bật/tắt: tắt thì gọi `DELETE` subscription và hủy đăng ký trong trình duyệt.
   - Mỗi thông báo có icon "đánh dấu đã đọc" riêng. Vẫn giữ "đánh dấu tất cả".
8. **QR ESL luôn hiện khi tra cứu thành công.** Không tự mở task khi chỉ có một task mở; hiện kết quả, QR và nút "Mở nhiệm vụ". Hành vi này nhất quán với mục 2: không tự thao tác thay người dùng.
9. **"Bật đèn" được giải thích tại chỗ.** Chỗ hiển thị trạng thái đèn có tooltip hoặc dòng mô tả ngắn, ví dụ "Đèn LED trên nhãn kệ sáng khi tồn kho chạm ngưỡng cảnh báo, tắt sau khi bổ sung".
10. **Barcode demo và quét ESL ở kiosk.**
    - Sửa chữ số kiểm tra cho 13 mã EAN-13 trong seed (đổi chữ số cuối). Cập nhật mọi test hoặc tài liệu đang tham chiếu mã cũ.
    - Thêm trang `/demo/barcodes`: in tờ A4 mã vạch EAN-13 của các sản phẩm theo cửa hàng, cùng bố cục với `/demo/esl-labels`. Link từ trang chủ.
    - Search kiosk nhận mã ESL: nếu query trùng mã ESL của cửa hàng thì trả về sản phẩm gắn với ESL đó, và quét bằng máy quét hoặc camera sẽ mở thẳng sản phẩm. Mã ESL không tồn tại thì báo thân thiện, không lỗi.
11. **Đăng nhập tách theo vai trò (phương án (a) đã chọn).**
    - `/staff/login` cho nhân viên và quản lý, `/admin/login` cho quản lý và admin. `/login` cũ chuyển thành trang chọn "Tôi là nhân viên / Tôi là quản trị", hoặc chuyển hướng theo `callbackUrl`.
    - Form không điền sẵn và không liệt kê tài khoản hay mật khẩu demo. Tài khoản demo ghi trong README để chia sẻ riêng với người test.
    - Đăng nhập sai vai trò (ví dụ STAFF vào `/admin/login`) báo rõ và gợi ý trang đúng.
    - Redirect của `/staff` và `/admin` (`page.tsx`) cùng `authOptions.pages.signIn` trỏ về trang tương ứng.
    - Giao diện đăng nhập thiết kế lại gọn và hiện đại (một cột ở mobile, ít chữ).
12. **Chữ to hơn.**
    - Nâng thang font toàn app: nội dung tối thiểu 14px, nhãn phụ và badge tối thiểu 12px, nút 14–15px. Kiosk có thể lớn hơn vì là màn hình đứng.
    - Gom về vài biến CSS thay vì giá trị rải rác. Đồng thời dọn bớt chi tiết rườm rà để màn hình thoáng.

## Ngoài phạm vi

- Không dùng WebSocket, SSE hay dịch vụ realtime bên ngoài (phương án B/C đã loại).
- Không làm tài khoản riêng cho từng người test hay mã mời (phương án (b) đã loại).
- Không thêm loại "yêu cầu" tự do không gắn sản phẩm/kệ. Task admin giao dùng ba loại hiện có, vì `Task.productId` và `shelfId` là bắt buộc (quyết định của mình, xem bên dưới).
- Không đổi quy tắc FEFO hay cron hằng ngày.

## Không được xảy ra

- Giá kiosk lấy từ lô quá hạn hoặc bị cách ly.
- Nhân viên chỉ mở xem mà task đã đổi trạng thái.
- Mã vạch in ra mà camera hoặc máy quét không đọc được.
- Trang đăng nhập vẫn lộ mật khẩu demo.
- Polling gây tải đáng kể: endpoint dấu thay đổi phải rẻ (một hoặc hai truy vấn aggregate có index) và dừng khi tab ẩn.

## Ràng buộc

- Next.js 16 App Router: đọc `node_modules/next/dist/docs` trước khi viết code (theo AGENTS.md). Ngoài ra React 19, next-auth 4 (credentials), Prisma 7 với Neon, deploy trên Vercel (serverless).
- Dùng lại thứ đã có: shadcn/ui, sonner, react-hook-form + zod, lucide-react, @zxing/browser, qrcode, web-push.
- Thay đổi schema (thêm `TASK_COMPLETED`) cần migration Prisma.
- Sau khi đổi seed phải chạy lại `db:seed` trên môi trường demo. README ghi rõ.
- Test bằng vitest (logic giá, chữ số kiểm tra EAN, tra ESL, quyền giao task, endpoint dấu thay đổi) và Playwright cho các luồng chính. `npm run check` phải xanh.

## Các phương án đã cân nhắc

**Đồng bộ thời gian thực**

| Phương án | Ưu | Nhược |
|---|---|---|
| A. Polling nhẹ 3–5s kèm làm mới khi focus và push/thông báo trong app | Chạy ổn trên Vercel, không thêm hạ tầng, độ trễ vài giây | Không tức thì 100% |
| B. SSE với Postgres LISTEN/NOTIFY | Gần tức thì | Pooler Neon không hỗ trợ LISTEN; Vercel cắt kết nối dài nên phải reconnect liên tục, dễ lỗi |
| C. Pusher/Ably | Tức thì, ổn định | Thêm tài khoản, khóa, chi phí và một điểm có thể hỏng |

→ **Chọn A** (người dùng đã duyệt).

**Tách đăng nhập**

| Phương án | Ưu | Nhược |
|---|---|---|
| (a) Trang login riêng theo vai trò, ẩn tài khoản demo | Nhanh, gọn, hết lộ mật khẩu | Người test vẫn dùng chung tài khoản |
| (b) Tài khoản hoặc mã mời riêng cho từng người test | Tránh dẫm chân nhau | Tốn công, thêm luồng quản lý tài khoản |

→ **Chọn (a)** (người dùng đã duyệt).

## Quyết định của mình (người dùng có thể sửa)

- Khoảng polling 4 giây; dừng khi tab ẩn.
- ESL có một task thì không tự mở task nữa (lý do ở mục 8).
- Task admin giao dùng ba loại có sẵn, không thêm loại "yêu cầu" tự do.
- Mã vạch EAN-13 vẽ bằng SVG tự viết (mã hóa EAN-13 đơn giản), không thêm thư viện. Nếu khó thì dùng `jsbarcode`.
- Tài khoản demo chuyển vào README.
- Thang font tối thiểu: nội dung 14px, phụ/badge 12px.

## Để người làm tự quyết

- Bố cục cụ thể của form giao task, danh sách task trong admin, và trang chọn vai trò ở `/login`.
- Hình dạng chính xác của endpoint dấu thay đổi (tên route, payload), miễn rẻ và đúng quyền.
- Màu badge theo token có sẵn.
- Thứ tự triển khai. Gợi ý: dữ liệu và giá → barcode/ESL → task và đồng bộ → admin → thông báo → login → font/UI.
