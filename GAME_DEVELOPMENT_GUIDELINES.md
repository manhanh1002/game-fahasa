# GAME DEVELOPMENT GUIDELINES & BEST PRACTICES (PRD)

Tài liệu này tổng hợp các kinh nghiệm, quy trình kiểm thử (Quality Check), bảo mật (Security), và chống gian lận (Anti-Cheat) đúc kết từ quá trình phát triển game trúng thưởng (Lottery/Lucky Draw). Tài liệu này dùng làm kim chỉ nam cho các dự án game sau này, đảm bảo tính ổn định, công bằng và bảo mật.

## 1. Tổng Quan (Overview)

Các game sự kiện (Event/Campaign Games) thường có đặc điểm:
-   **Traffic tăng đột biến (Spike Traffic):** Hàng nghìn người chơi cùng truy cập tại một thời điểm.
-   **Giới hạn phần thưởng (Limited Inventory):** Số lượng quà có hạn, không được phép trao lố (Overselling).
-   **Môi trường Distributed:** Server có thể chạy nhiều instances, Database có thể có độ trễ đồng bộ (Propagation Delay).

## 2. Quy Trình Quality Check (QC Process)

Mọi tính năng quan trọng đều phải trải qua quy trình QC nghiêm ngặt trước khi Deploy Production.

### 2.1. Functional Testing (Kiểm thử chức năng)
-   **Happy Path:** Người chơi hợp lệ tham gia -> Nhận quà đúng logic -> DB cập nhật đúng.
-   **Out of Stock:** Hết quà -> Người chơi nhận thông báo hết quà/chúc may mắn -> DB không bị trừ âm.
-   **Error Handling:** Mất mạng, lỗi DB, lỗi Server -> Hệ thống không bị treo, hiển thị thông báo thân thiện.

### 2.2. Concurrency & Load Testing (Kiểm thử chịu tải & Đồng thời)
Đây là bước **QUAN TRỌNG NHẤT** cho game có quà giới hạn.
-   **Kịch bản 1: Spam cùng 1 User (Double Spending Attack)**
    -   *Mô tả:* Một người dùng mở nhiều tab hoặc dùng tool gửi 10-100 request cùng lúc.
    -   *Yêu cầu:* Chỉ 1 request được xử lý, các request còn lại phải bị chặn (Status 429 hoặc 409).
    -   *Tool kiểm tra:* Script Node.js sử dụng `Promise.all` để bắn request song song.
-   **Kịch bản 2: Nhiều User tranh nhau 1 quà (Race Condition)**
    -   *Mô tả:* Còn 1 quà cuối cùng, 10 người bấm nhận cùng lúc.
    -   *Yêu cầu:* Chỉ đúng 1 người nhận được, 9 người còn lại nhận thông báo hết quà. Không được trao lố (Inventory không được < 0).

### 2.3. UI/UX Stress Test
-   **Loading State:** Đảm bảo nút bấm bị disable hoặc biến mất ngay khi click để tránh double-click.
-   **Animation:** Hiệu ứng (quay số, rung bao lì xì) phải mượt mà, không gây hiểu lầm về kết quả (ví dụ: hiện quà trước khi server trả về).
-   **Flicker:** Tránh hiện tượng nháy nút (ví dụ: hiện nút "Bắt đầu" 1 giây rồi mới chuyển sang "Đã chơi").

---

## 3. Database Check & Design Strategy

Thiết kế Database quyết định 50% độ ổn định của game.

### 3.1. Chiến lược khóa (Locking Strategy)
-   **Không dùng cột Logic chung với cột Lock:**
    -   *SAI:* Dùng cột `note` hoặc `status` để làm lock tạm thời.
    -   *ĐÚNG:* Tạo cột riêng biệt `lock_status` (hoặc `order_status` nếu tái sử dụng) để quản lý Distributed Lock.
-   **Cơ chế Distributed Lock (Optimistic Locking with Polling):**
    1.  Tạo `LockID` unique (UUID + Timestamp).
    2.  Check xem record có đang bị lock bởi người khác không (`lock_status` not null & not stale).
    3.  Update `lock_status = LockID`.
    4.  **Quan trọng:** Sau khi update, phải **Polling (đọc lại liên tục)** trong 1 khoảng thời gian (ví dụ: 5-10s) để đảm bảo dữ liệu đã được đồng bộ trên toàn bộ cụm Database (đặc biệt với NocoDB hoặc các DB phân tán).
    5.  Chỉ khi đọc lại thấy `lock_status == LockID` mới được coi là Lock thành công.

### 3.2. Data Consistency (Tính nhất quán)
-   **Post-Commit Verification (Double Check):**
    -   Sau khi trao quà và update DB, hệ thống nên có bước kiểm tra lại (Fail-Safe).
    -   Nếu phát hiện trao lố (Số lượng winner > Limit), hệ thống tự động VOID kết quả của những người đến sau (dựa trên `UpdatedAt` hoặc Rank).

---

## 4. Anti-Cheat & Security Check

### 4.1. Client-Side Security (Bảo mật phía Client)
-   **Nguyên tắc số 1: Never Trust Client.**
    -   Không bao giờ để logic trúng thưởng (Random) ở Client JS.
    -   Không lưu thông tin nhạy cảm (số lượng quà còn lại chính xác, danh sách code trúng giải) ở biến toàn cục (Global Variables).
-   **Obfuscation:** Minify và Obfuscate code Javascript để hạn chế việc soi code, nhưng đừng phụ thuộc vào nó.
-   **UI Protection:**
    -   Disable chuột phải, F12 (chỉ chặn được người dùng phổ thông, không chặn được Hacker).
    -   Sử dụng Loading Overlay che toàn màn hình khi đang xử lý request.

### 4.2. Server-Side Security (Bảo mật phía Server)
-   **Input Validation:**
    -   Luôn validate `code`, `token`, `input` bằng Regex (chỉ cho phép ký tự hợp lệ).
    -   Chặn SQL Injection / NoSQL Injection.
-   **Idempotency (Tính bất biến):**
    -   Một request (cùng User, cùng Action) dù gửi 1 lần hay 10 lần thì kết quả trả về phải như nhau (hoặc các lần sau báo lỗi "Đã xử lý").
-   **Rate Limiting:**
    -   Giới hạn số request/giây cho mỗi IP hoặc mỗi User ID.
-   **Environment Variables:**
    -   Tuyệt đối không hardcode API Key, DB Token trong code. Luôn dùng `.env`.

### 4.3. Các kịch bản gian lận phổ biến & Cách phòng chống

| Kịch bản gian lận | Giải pháp (Solution) |
| :--- | :--- |
| **Dùng Tool Spam Request** | Áp dụng Distributed Lock + Rate Limit. Check trạng thái `isProcessing` trong RAM server (nếu single instance) hoặc Redis (nếu multi instance). |
| **Race Condition (Tranh quà)** | Dùng Global Mutex (xếp hàng request) hoặc Optimistic Locking ở Database level. |
| **Sửa API Response** | Logic hiển thị quà phải dựa trên dữ liệu gọi lại từ Server (`/check-status`), không tin tưởng response của API `/play` nếu không cần thiết. |
| **Reset Database trái phép** | Bảo vệ API Reset, không public ra ngoài Internet. Dùng Token quyền admin riêng biệt. |

---

## 5. Solution Architecture (Kiến trúc giải pháp đề xuất)

Đối với các game sau này, nên áp dụng mô hình sau:

### 5.1. Tech Stack
-   **Backend:** Node.js (Express/Fastify) hoặc Go.
-   **Database:** PostgreSQL/MySQL (Transaction hỗ trợ tốt hơn) hoặc NocoDB (nhưng phải xử lý kỹ phần Delay).
-   **Cache/Lock:** Redis (Best practice cho Distributed Lock & Counter).

### 5.2. Logic Flow (Safe Flow)
1.  **Request In:** User gửi request chơi game.
2.  **Gatekeeper:** Check Rate Limit -> Check Input -> Check `isProcessing` (In-Memory).
3.  **Locking:** Acquire Distributed Lock (Redis/DB).
4.  **Validation:** Đọc DB (Current Status, Inventory).
5.  **Logic:** Random quà (Server side).
6.  **Commit:** Update DB (Status = WIN, Prize = X).
7.  **Safety Net:** (Optional) Đọc lại DB để confirm không bị Oversell.
8.  **Unlock:** Release Lock.
9.  **Response:** Trả kết quả cho Client.

### 5.3. Xử lý lỗi (Recovery)
-   Nếu lỗi xảy ra giữa chừng (sau khi Lock, trước khi Commit): Phải đảm bảo Release Lock (dùng `finally` block).
-   Nếu Timeout DB: Trả về lỗi "Hệ thống bận", không trả về kết quả thắng/thua mơ hồ.

---

## 6. Business Rules & Compliance (Quy định nghiệp vụ)

### 6.1. Thời gian hiệu lực của lượt chơi (10-Minute Rule)
Để tránh việc người chơi "treo" máy hoặc chiếm dụng tài nguyên game mà không thực hiện hành động, hệ thống áp dụng quy tắc 10 phút:
-   **Kích hoạt:** Thời gian bắt đầu đếm ngược ngay khi người chơi truy cập vào link (Hệ thống ghi nhận lần đầu qua API `/check`).
-   **Trạng thái:** Status chuyển từ `INVITED` sang `OPENNING` để đánh dấu bắt đầu timer.
-   **Hết hạn:** Nếu sau 10 phút kể từ lúc truy cập mà người chơi vẫn ở trạng thái `INVITED` hoặc `OPENNING` (chưa bấm nhận quà để sang `PLAYER`), lượt chơi đó sẽ bị coi là **Hết hạn (EXPIRED)**.
-   **Xử lý:** Người chơi sẽ không thể chơi tiếp, hệ thống hiện thông báo "Hết hạn tham gia" và ghi nhận trạng thái `EXPIRED` vào Database để chặn các truy cập sau này.

### 6.2. Xử lý trạng thái lỗi (Zombie State Prevention)
-   **Nguyên tắc:** Nếu một request trúng quà nhưng bị lỗi trong quá trình update Database (dẫn đến trạng thái `PLAYER` nhưng không có thông tin `prize`), hệ thống phải **tự động hoàn tác (Revert)** về trạng thái `INVITED`.
-   **Lợi ích:** Đảm bảo người chơi không bị mất lượt oan do lỗi kỹ thuật và có thể thử lại.

---

**Lưu ý cuối cùng:** Không có hệ thống nào hoàn hảo 100%. Việc Monitoring (theo dõi log) thời gian thực trong lúc chạy campaign là bắt buộc để xử lý nóng các tình huống phát sinh.
