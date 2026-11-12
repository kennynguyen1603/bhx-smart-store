# BHX Smart Store MVP

Prototype web tương tác cho hai trải nghiệm trong tài liệu `DTB-VTV4-4.md`:

- **Staff Task App:** nhiệm vụ bổ sung hàng, cảnh báo từ POS, quét ESL, cập nhật tồn kệ và nhiệm vụ FEFO.
- **In-store Kiosk:** tìm kiếm/quét mã sản phẩm và xem đường đi trên bản đồ cửa hàng.

## Chạy cục bộ

Đây là ứng dụng HTML/CSS/JavaScript thuần, không cần cài dependency:

```bash
python3 -m http.server 4173 --directory dist
```

Mở `http://localhost:4173` trong trình duyệt.

## Dữ liệu demo

Dữ liệu được lưu trong `localStorage` của trình duyệt. Chọn nút trợ giúp `?` ở màn hình đầu và bấm **Đặt lại dữ liệu demo** để trở về trạng thái ban đầu.

Không có dữ liệu thật, kết nối POS, camera hoặc thiết bị ESL trong MVP này.
