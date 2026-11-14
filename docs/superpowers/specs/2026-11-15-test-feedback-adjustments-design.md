# Thiết kế điều chỉnh theo feedback kiểm thử

## Mục đích

Hoàn thiện luồng demo để giá FEFO được phản ánh nhất quán trên kiosk, thao tác quét ESL trở thành điểm vào công việc, và quyền xem nhiệm vụ giữa Staff và Manager đúng trách nhiệm thực tế.

## Mục tiêu

- Kiosk hiển thị giá FEFO hiện hành, giá gốc gạch ngang và phần trăm giảm ở cả danh sách lẫn chi tiết.
- Nút “Quét ESL” mở camera hoặc cho nhập mã, xác minh ESL và dẫn đến nhiệm vụ phù hợp.
- Staff chỉ thấy nhiệm vụ của mình và nhiệm vụ chưa có người nhận; Manager thấy toàn bộ nhiệm vụ của cửa hàng cùng người thực hiện và thời gian hoàn thành.
- Có mã QR ESL demo tạo từ định danh ESL ổn định để quét minh họa.
- Mở chi tiết sản phẩm trên kiosk gần như tức thì, không hiện thông báo đồng bộ toàn cục và không tải lại dữ liệu cửa hàng không cần thiết.

## Ngoài phạm vi và yêu cầu tránh

- Không kết nối thiết bị ESL vật lý, thay đổi POS/thanh toán hoặc xây báo cáo hiệu suất chuyên sâu.
- Không chỉ ẩn dữ liệu ở giao diện; phân quyền phải được áp dụng tại API.
- Không nhúng giá hoặc tồn kho vào QR và không tự hoàn thành nhiệm vụ sau khi quét.
- Staff không được thao tác nhiệm vụ đã được người khác nhận.

## Phương án

1. Quét ESL chỉ để xem thông tin: đơn giản nhưng nhân viên phải tự tìm nhiệm vụ.
2. Quét ESL luôn mở nhiệm vụ: nhanh nhưng không xử lý tốt khi không có hoặc có nhiều nhiệm vụ.
3. Luồng kết hợp: hiển thị thông tin ESL, tự mở khi có đúng một nhiệm vụ, cho chọn khi có nhiều, và vẫn trả kết quả hữu ích khi chưa có nhiệm vụ.

Chọn phương án 3 vì phù hợp quy trình vận hành và xử lý đầy đủ các trạng thái demo.

## Thiết kế chi tiết

### Giá FEFO trên kiosk

API tìm kiếm lấy lô còn bán, ưu tiên theo hạn sử dụng giống API chi tiết, rồi trả `priceVnd`, `originalPriceVnd` và `markdownPercent`. Khi có giảm giá, danh sách và chi tiết hiển thị giá mới nổi bật, giá gốc gạch ngang và nhãn phần trăm; nếu không giảm thì chỉ hiện giá thường.

### Quét ESL độc lập

Nút “Quét ESL” mở modal dùng camera hiện có và ô nhập mã dự phòng. API tra cứu trả ESL, sản phẩm, kệ và các nhiệm vụ đang mở mà người dùng được phép thấy:

- Một nhiệm vụ: mở thẳng chi tiết.
- Nhiều nhiệm vụ: hiển thị danh sách để chọn.
- Không có nhiệm vụ: hiển thị thông tin ESL và thông báo rõ ràng.

Quét chỉ xác minh ngữ cảnh; hoàn thành vẫn cần xác nhận riêng.

### Phân quyền nhiệm vụ

- Staff: API trả nhiệm vụ chưa có người nhận hoặc có `assigneeId` là chính họ; lịch sử hoàn thành chỉ gồm nhiệm vụ họ hoàn thành.
- Manager: API trả toàn bộ nhiệm vụ tại cửa hàng được phân quyền, gồm người nhận/người hoàn thành và thời điểm hoàn thành.
- Backend từ chối Staff bắt đầu hoặc hoàn thành nhiệm vụ đã thuộc nhân viên khác.
- Giao diện Manager hiển thị người phụ trách trên danh sách và cho lọc trạng thái để kiểm tra kết quả nhân viên.

### QR ESL demo

QR chỉ chứa định danh như `ESL-NT-Q5-COLD-01`. Một thành phần demo cho phép chọn ESL hiện có, hiển thị QR đủ lớn để quét từ thiết bị khác và hiện chuỗi mã để nhập thủ công. Không tạo bản ghi ESL không gắn hợp lệ với cửa hàng, kệ và sản phẩm.

### Tốc độ mở chi tiết sản phẩm

Nguyên nhân hiện tại là mỗi lần click đều gọi lại API chi tiết, tải toàn bộ zone/kệ để dựng bản đồ và dùng chung trạng thái loading toàn cục với tìm kiếm. Chọn phương án prefetch kết hợp cache phía client và tách dữ liệu cửa hàng dùng chung:

- Mở modal ngay từ dữ liệu sản phẩm đã có trong kết quả tìm kiếm; dữ liệu chi tiết được bổ sung ở nền.
- Prefetch chi tiết khi người dùng hover, focus hoặc bắt đầu chạm vào thẻ sản phẩm.
- Cache chi tiết theo khóa `storeCode + productId` trong phiên kiosk với thời gian sống ngắn 30–60 giây.
- Cache sơ đồ theo `storeCode` và không tải lại toàn bộ zone/kệ cho mỗi sản phẩm.
- Xóa cache liên quan khi đổi cửa hàng hoặc kết thúc phiên kiosk.
- Tách trạng thái tải tìm kiếm và tải chi tiết; không hiện toast “Đang đồng bộ dữ liệu cửa hàng” khi click sản phẩm. Nếu chưa có dữ liệu, dùng loading cục bộ kín đáo trong modal.
- Không bổ sung Redis. Redis chỉ được cân nhắc sau này nếu đo đạc cho thấy truy vấn cơ sở dữ liệu là nút thắt trên nhiều instance hoặc số lượng kiosk lớn.

## Ràng buộc và lựa chọn triển khai

- Giữ Next.js, Prisma, ZXing và cấu trúc Staff/Kiosk hiện tại.
- Dùng các trường giá trên `Lot` và các trường phân công trên `Task` hiện có; dự kiến không cần migration.
- Có thể bổ sung thư viện tạo QR phía giao diện nếu dự án chưa có khả năng phù hợp.
- Ưu tiên cache nhẹ bằng cấu trúc dữ liệu hiện có của React; không thêm thư viện cache nếu chưa cần thiết.

## Kiểm thử chấp nhận

- Hoàn thành FEFO rồi tìm sản phẩm trên kiosk: danh sách và chi tiết hiện đúng giá gốc, giá giảm và phần trăm.
- Bấm “Quét ESL” từ màn hình chính, quét/nhập mã hợp lệ và mở được nhiệm vụ tương ứng.
- Mã sai hoặc thuộc cửa hàng khác trả thông báo phù hợp.
- Staff A không thấy lịch sử và không sửa được nhiệm vụ của Staff B.
- Manager thấy nhiệm vụ hoàn thành của mọi nhân viên, tên người thực hiện và thời gian hoàn thành.
- QR demo được ZXing đọc đúng định danh và dùng được trong luồng quét.
- Click sản phẩm mở phản hồi ngay, không hiện toast đồng bộ toàn cục; mở lại trong thời gian cache không gọi lại API chi tiết.
- Đổi cửa hàng không sử dụng dữ liệu chi tiết hoặc sơ đồ đã cache của cửa hàng trước.
