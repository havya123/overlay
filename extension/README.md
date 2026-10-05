# Guitar Island YouTube Sync

## Cài đặt

1. Chạy `node server.js`.
2. Mở `chrome://extensions` hoặc `edge://extensions`.
3. Bật **Developer mode**, chọn **Load unpacked** và chọn thư mục `extension/`.
4. Mở phần cấu hình extension, nhập `http://localhost:7777`.
5. Nếu chạy server với `OVERLAY_TOKEN`, nhập cùng token vào extension và mở các URL overlay/control với `?token=TOKEN`.
6. Mở video YouTube, bấm biểu tượng extension rồi chọn **Kết nối tab này**.

Extension chỉ đọc trạng thái video YouTube và gửi metadata/thời gian về server. Nó không chặn quảng cáo, tải audio hoặc tách audio. Muốn phát YouTube không quảng cáo, dùng YouTube Premium hoặc nguồn âm thanh mà bạn có quyền sử dụng.

MVP chỉ có một tab owner được chọn thủ công. Muốn chuyển nguồn, bấm **Ngắt đồng bộ** ở tab owner trước, rồi mở tab mới và bấm **Kết nối tab này**. Tab owner khác không thể ghi đè khi lease còn hiệu lực.
