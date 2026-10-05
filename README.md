# 🎸 Guitar Island — OBS Overlay

Overlay "Now Playing" kiểu **Dynamic Island** cho stream guitar: đĩa than quay, soundwave nhảy theo nhạc, chuyển động lò xo mượt.

## Chạy

```bash
node server.js      # hoặc double-click start.bat, hoặc npm start
```

Không cần cài thư viện nào (chỉ cần Node.js).

## Thêm vào OBS

1. **Overlay**: `Sources → + → Browser`
   - URL: `http://localhost:7777/overlay.html`
   - Width `800`, Height `200`
2. **Bảng điều khiển**: `Docks → Custom Browser Docks…`
   - Tên: `Guitar Island`, URL: `http://localhost:7777/control.html`
3. **Điều khiển bằng điện thoại** (tiện khi đang ôm đàn): mở link LAN mà server in ra, ví dụ `http://192.168.1.10:7777/control.html`

## Tham số URL của overlay

| Tham số | Ví dụ | Ý nghĩa |
|---|---|---|
| `pos` | `?pos=bottom` | `top` (mặc định), `bottom`, `center` |
| `scale` | `?scale=1.4` | Phóng to/thu nhỏ island (so với kích thước mặc định) |

## Animation

- **Play**: island nở ra → cần đĩa hạ xuống → đĩa tăng tốc quay → soundwave bật lên, viền gradient xoay, glow "thở" theo âm lượng
- **Pause**: cần đĩa nhấc lên → đĩa quay chậm dần rồi dừng (như mâm đĩa thật) → island thu về dạng nhỏ
- **Đổi bài**: island "nảy" nhẹ, chữ trượt lên; tên dài sẽ tự chạy chữ (marquee)

## Ảnh bìa & tự điền thông tin

- **Gõ tên bài** → danh sách gợi ý từ Apple Music hiện ra (gõ không dấu vẫn tìm được bài tiếng Việt). Chọn bằng chuột hoặc `↑ ↓ Enter` → tự điền tên bài chuẩn, nghệ sĩ và ảnh bìa.
- Gõ xong mà không chọn gợi ý (bấm Tab / click ra ngoài): nếu tên bài khớp chính xác, nghệ sĩ và ảnh bìa sẽ tự điền. Ô nào bạn đã tự gõ thì không bị ghi đè.
- Ảnh bìa còn có thể **tải lên**, **kéo thả**, **Ctrl+V** hoặc chọn từ nút **Tìm tự động** (nhiều bản album khác nhau).
- Ảnh được lưu vào thư mục `covers/`, nên lúc stream không phụ thuộc mạng.
- Trên overlay: ảnh bìa phủ kín đĩa than + nền gradient nhẹ lấy màu từ ảnh bìa. Bật **Màu theo ảnh bìa** để glow, viền và soundwave đổi màu theo ảnh.
- Các thay đổi chỉ lên overlay khi bấm **Cập nhật** (nút sẽ nhấp nháy khi có thay đổi chưa áp dụng).

## Đồng bộ YouTube (extension)

Overlay có thể tự cập nhật theo video YouTube đang mở, bao gồm tên bài, kênh/nghệ sĩ, thumbnail, play/pause, seek và thời lượng thật.

### Công nghệ lấy dữ liệu YouTube

Extension Chrome/Edge được viết bằng **JavaScript**, dùng **Manifest V3**. Content script chạy trong trang YouTube để đọc thông tin từ HTML (**DOM scraping**) và trạng thái của thẻ `<video>` qua **HTMLMediaElement API**. Cơ chế này không cần YouTube Data API hoặc API key.

| Dữ liệu | Cách lấy |
|---|---|
| Tên video | Đọc tiêu đề trên trang bằng `document.querySelector()`, dùng `document.title` làm dự phòng |
| Kênh/nghệ sĩ | Đọc tên kênh từ HTML; trường nghệ sĩ hiện tại là tên kênh YouTube |
| ID video | Đọc tham số `v` trong URL của trang |
| Ảnh bìa | Ghép URL `https://i.ytimg.com/vi/{videoId}/hqdefault.jpg` |
| Vị trí phát, thời lượng, tốc độ | Đọc `currentTime`, `duration`, `playbackRate` của thẻ `<video>` |
| Trạng thái phát | Đọc `paused`, `ended` và lắng nghe sự kiện `play`, `pause`, `seeked`, `ended`, `ratechange` |

Content script dùng `MutationObserver` và kiểm tra mỗi 500 ms để nhận biết khi trang đổi video hoặc thay thẻ `<video>`. Dữ liệu được gửi khi có sự kiện phát/tua/dừng, khi vị trí phát thay đổi và định kỳ mỗi 2 giây. Service worker chỉ chuyển dữ liệu của tab đã được người dùng kết nối đến server.

Luồng đồng bộ:

```text
Tab YouTube: content script đọc HTML và thẻ <video>
  → chrome.runtime.sendMessage()
  → Service worker của extension
  → HTTP POST JSON đến /api/youtube/sync trên server Node.js
  → Server-Sent Events (SSE) qua /api/events
  → Overlay và bảng điều khiển cập nhật giao diện
```

Các phần triển khai chính:

- [extension/content.js](extension/content.js): đọc dữ liệu và theo dõi video.
- [extension/background.js](extension/background.js): quản lý tab kết nối và gửi dữ liệu đến server bằng `fetch()`.
- [server.js](server.js): nhận dữ liệu YouTube, cập nhật trạng thái và phát cập nhật qua SSE.
- [shared.js](shared.js): nhận cập nhật bằng `EventSource` để đồng bộ overlay và bảng điều khiển.

Cách này theo dõi được trạng thái phát thực tế của tab đang mở. Các bộ chọn HTML lấy tiêu đề và tên kênh có thể cần cập nhật khi YouTube thay đổi giao diện.

### Thiết lập đồng bộ

1. Chạy server: `node server.js`.
2. (Khuyến nghị khi điều khiển qua LAN) chạy với token: `OVERLAY_TOKEN=mat-khau-cua-ban node server.js`.
3. Mở `chrome://extensions` hoặc `edge://extensions`, bật **Developer mode**, chọn **Load unpacked** và chọn thư mục `extension/`.
4. Mở phần cấu hình extension, nhập `http://localhost:7777` và token nếu đã bật.
5. Mở video YouTube, bấm biểu tượng **Guitar Island**, rồi bấm **Kết nối tab này**.
6. Nếu server bật token, mở Control/Overlay với `?token=mat-khau-cua-ban`. Ví dụ: `http://localhost:7777/control.html?token=mat-khau-cua-ban`.

Chỉ một tab YouTube được kết nối thủ công làm nguồn owner tại một thời điểm. Muốn chuyển nguồn, hãy bấm **Ngắt đồng bộ** ở extension của tab owner trước rồi mới kết nối tab khác. Extension chỉ đọc trạng thái video và không chặn quảng cáo, tải audio hoặc tách audio. Muốn YouTube không quảng cáo, hãy dùng YouTube Premium hoặc một nguồn âm thanh mà bạn có quyền sử dụng. Tắt công tắc đồng bộ YouTube trong Control để quay lại chế độ thủ công.

`HOST=127.0.0.1` có thể dùng để chỉ cho phép kết nối trên máy stream; mặc định server vẫn bind LAN để hỗ trợ điều khiển bằng điện thoại.


Mặc định soundwave là **giả lập** (mô phỏng nhịp quạt chả). Muốn soundwave nhảy theo tiếng đàn thật:

1. Thêm `--enable-media-stream` vào cuối ô *Target* trong shortcut OBS, ví dụ
   `"C:\Program Files\obs-studio\bin\64bit\obs64.exe" --enable-media-stream`
2. Chọn **Micro thật** trong bảng điều khiển. Overlay dùng micro mặc định của Windows.

Không mở được micro thì overlay tự quay về chế độ giả lập.

Khi **Đồng bộ YouTube** đang bật, setlist không đổi video YouTube. Bấm một bài trong setlist để chọn/bỏ chọn bài hiển thị ở bong bóng **Next**; thao tác này không thay đổi bài, timer hoặc trạng thái YouTube.


- Overlay có một bong bóng nhỏ **"Next"** ở góc dưới bên trái island, hiện bài kế tiếp trong setlist (bài đang phát không có trong setlist → hiện bài đầu tiên).
- Trong setlist, bài kế tiếp được gắn nhãn **Tiếp theo**. Bấm nút ⏭ (hoặc phím `N`) để chuyển sang bài đó.
- **Sắp xếp setlist**: kéo biểu tượng ⋮⋮ ở đầu mỗi bài (dùng được cả chuột lẫn cảm ứng trên điện thoại), hoặc chọn bài rồi bấm `Alt + ↑/↓`. Bài nằm ngay dưới bài đang phát sẽ là bài **Next**. Dùng ô tìm kiếm để lọc theo tên/nghệ sĩ; mỗi trang hiển thị tối đa 10 bài. Khi đang tìm kiếm, kéo sắp xếp được tắt để không làm đổi nhầm thứ tự.
- Tắt/bật bong bóng bằng công tắc **Hiện "Next" trên overlay** ở cuối thẻ Setlist.

## Phím tắt

- `Space` trong bảng điều khiển: phát / tạm dừng
- `N`: chuyển sang bài tiếp theo trong setlist
