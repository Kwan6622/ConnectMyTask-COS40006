# MERGE-CMT — Ghi chú thay đổi

Cập nhật: 2026-11-27 · Branch git: `merge-test-features` · DB: Neon branch `quang_testing`

MERGE-CMT là bản chạy local để thử các tính năng của `TEST_CMT` (`sub_testing`) trên nền `main` mới nhất trước khi đưa về repo chung.

## 1. Trạng thái git

| Nguồn | Commit | Ghi chú |
|---|---|---|
| `main` (lần ghép đầu) | `9e95d7a` | Nền của MERGE (2026-11-21) |
| `sub_testing` (TEST_CMT) | `09849b8` | Tính năng riêng của Quang; khi trùng thì bản TEST được giữ |
| `main` (lần ghép 2) | `5211175` | 5 commit mới, ghép ngày 2026-11-27, không có xung đột |

- Merge **chưa được commit**. `.git/MERGE_HEAD` chứa cả `09849b8` và `5211175`, nên khi commit, merge commit sẽ có 3 parent. Nhờ vậy khi đưa về `main` sẽ không phải ghép lại 5 commit kia.
- Bản sao lưu index và `MERGE_HEAD` trước lần ghép 2 đang để trong scratchpad của Claude, có thể bị xóa bất cứ lúc nào.
- **Ký tự xuống dòng:** có `core.autocrlf=true`, nhưng nhiều file mới được ghi bằng LF. Nếu tính cả khác biệt CRLF, `git diff origin/main` báo 3.752 dòng thêm; bỏ qua CRLF thì chỉ còn 1.546 dòng thêm và 300 dòng xóa trên 49 file. Nên chuẩn hóa (`git add --renormalize .`) trước khi commit để diff gọn và đỡ xung đột giả.

## 2. Ghép từ `main` mới (`9e95d7a..5211175`)

| Commit | Tác giả | Nội dung |
|---|---|---|
| `86844bc`, `5211175` | dbao51 | Chuyển Neon TEST branch dùng chung sang `e2e-test-20261122`; viết lại `DATABASE_TEST_SETUP.md`, `README.md`, `TEST_ACCOUNTS.md` |
| `6d27a56` | dbao51 | Escrow chặt hơn và làm lại Transaction History (web và mobile) |
| `8520e75` | nguyenngochuyhoang1010 | `ai-service/test_pricing.py`: test API gợi ý giá |
| `5543c02` | dbao51 | Seed tài khoản test đọc mật khẩu từ `TEST_ACCOUNT_PASSWORD`, không sinh file credentials nữa |

Thay đổi escrow:

- Provider chỉ có thể báo hoàn thành bằng progress 100% kèm `markAsCompleted`. Chuyển thẳng `PATCH status = PENDING_CONFIRMATION` sẽ nhận 409.
- Muốn release tiền phải có đủ: provider đã đánh dấu hoàn thành, requester đã xác nhận (`COMPLETED`/`HELD`), và không có tranh chấp `OPEN` hay `UNDER_REVIEW`.
- Requester xác nhận thì task chuyển sang `COMPLETED` trước. Nếu release lỗi, API trả về `settlementPending: true`, tiền vẫn bị giữ và có thể thử lại.
- Tiền trả cho provider chỉ được ghi nhận dạng **TEST/DEMO** (`settlementMode: SIMULATED_DEMO`), không có giao dịch Stripe Connect thật. Khi `NODE_ENV=production`, API trả 503.

Có 3 file bị sửa ở cả hai phía và đã giữ được thay đổi của cả hai: `src/modules/tasks/service.js`, `frontend-mobile/src/store/taskStore.ts`, `frontend-mobile/src/types/index.ts`.

## 3. Tính năng lấy từ TEST_CMT

**Backend**

- `src/modules/geocoding/` (mới): `POST /api/tasks/verify-address` (chỉ REQUESTER/CLIENT) xác minh số nhà, tên đường và phường qua distancematrix.ai.
- `src/modules/tasks/service.js`:
  - Khi tạo task, tọa độ client gửi lên bị thay bằng tọa độ đã geocode.
  - Ẩn `isSuspicious`, `suspiciousReason`, `riskLevel` với requester và khách chưa đăng nhập (`getTaskForViewer`, `canViewRisk`).
  - Phần gợi ý task dùng phường của user khi provider chưa đặt district.
- `src/modules/tasks/validation.js`: thêm `streetName`; `siteLatitude`/`siteLongitude` không còn bắt buộc.
- `src/shared/middlewares/auth.js`: thêm `authenticateIfPresent`, dùng cho list/detail task.
- `src/modules/auth/`: đăng ký bắt buộc có `location`. `src/modules/users/`: cho sửa `location`; gửi `district` là chuỗi rỗng sẽ xóa district.
- `src/server.js`: listen trên `0.0.0.0`, để điện thoại trong mạng LAN gọi được.
- `src/shared/hoChiMinhWards.js` và `src/modules/tasks/districtAdjacency.js`: danh sách 102 phường mới của TP.HCM theo quận cũ, cùng bảng quận giáp ranh.

**Web** (`frontend-web/src`)

- `LoginPage`, `Auth/RegisterPage`: đăng ký phải chọn phường.
- `TaskPostPage`, `components/task/TaskLocationPicker`: nhập số nhà và tên đường, rồi xác minh địa chỉ trước khi đăng task.
- `ProfilePage`: sửa phường; provider có thể xóa district.
- `TaskBrowsePage`, `TaskDetailPage`, `TrackingPage`, `SupportPage`: lọc theo phường, ẩn trường rủi ro, chỉnh UI.

**Mobile** (`frontend-mobile/src`)

- `components/WardSelect.tsx` (mới); `app/sign-up.tsx`, `app/post-task.tsx`, `app/profile.tsx`, `app/task-detail.tsx`, `components/TaskLocationPickerMap.tsx`: các tính năng tương tự bản web.
- `app/sign-in.tsx`: bỏ nút AI Assistant ở màn đăng nhập.
- `package.json` và `README.md` của mobile được cập nhật.

## 4. Thay đổi thêm trong MERGE (chưa có ở TEST hay main)

### 4.1 Cloudinary

- `frontend-web/.env` (không commit): `VITE_CLOUDINARY_CLOUD_NAME=dgwxtzios`, `VITE_CLOUDINARY_UPLOAD_PRESET=connectmytask_unsigned`, `VITE_CLOUDINARY_UPLOAD_ENDPOINT`.
- `frontend-mobile/.env` (không commit): 3 biến tương tự với tiền tố `EXPO_PUBLIC_`.
- `frontend-web/.env.example` (mới). Trong `.env.example` gốc, sửa tên cloud sai `dgwtzios` thành `dgwxtzios`.
- Root `.env`: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (đang để trống). Upload unsigned không dùng tới 3 biến này.
- Đã thử upload unsigned thật và nhận HTTP 200. Ảnh test `px` (tag `cmt_connectivity_test`) vẫn còn trong Media Library, có thể xóa.

### 4.2 Bảng Location (`database/prisma`)

- Migration `20261121000000_user_location`: thêm `USERS.location`.
- Migration `20261125000000_location_tables`:
  - Bảng `DISTRICTS` (24 quận), `LOCATIONS` (102 phường) và `DISTRICT_NEIGHBORS` (75 cặp quận giáp ranh).
  - Khóa ngoại `USERS.locationId`, `TASKS.locationId`, `PROVIDER_PROFILES.serviceDistrictId`, tất cả `ON DELETE SET NULL`.
  - Hàm `cmt_location_id()`, `cmt_district_id()` và trigger `USERS_sync_location`, `TASKS_sync_location`, `PROVIDER_PROFILES_sync_district`. Trigger tự gán khóa ngoại từ cột chữ `location`/`district`, nên code backend không phải sửa.
- Đổi phường "Phu Tho" (Tân Phú) thành "Phu Tho Hoa" ở cả 3 danh sách phường (backend, web, mobile).

### 4.3 Xác minh địa chỉ (`src/modules/geocoding/service.js`)

Phần này được viết lại. API distancematrix.ai lặp lại bất kỳ phường nào có trong câu truy vấn và tự đặt một điểm cách nhà thật 0,7–5 km, nên địa chỉ sai phường vẫn được chấp nhận. Thử với 29 địa chỉ thật, bản cũ sai 14; bản mới không sai trường hợp nào.

- Bắt buộc số nhà; thiếu thì không gọi API.
- Geocode trước mà **không** kèm phường, rồi so phường trả về phải trùng khớp hoàn toàn. Chỉ dùng kết quả có kèm phường khi:
  - hai điểm cách nhau ≤ 300 m, hoặc
  - kết quả không kèm phường rơi vào một con đường trùng tên nằm ngoài 102 phường, hoặc
  - không có kết quả không kèm phường nào dùng được.
- Khi sai phường, thông báo lỗi nêu phường đúng, ví dụ: *"10 Nguyen Hue" belongs to Sai Gon, not Ben Thanh*.
- Hỗ trợ alias tên đường (Ba Thang Hai ↔ 3 Thang 2, CMT8, ...), số nhà dạng `A35` hoặc `12/3`; không coi số hẻm `/50` là số nhà 50.
- **Địa chỉ trong hẻm** (2026-11-27): API không xử lý được dạng `47/24 Bui Dinh Tuy`. Nó trả về kết quả rỗng hoặc một hẻm sâu hơn (`47/24/30C`), nên địa chỉ bị từ chối. Khi lần tra đầu không khớp, hệ thống tra thêm theo dạng `24 Hem 47 Bui Dinh Tuy`; dạng này cho đúng căn `47/24 Hẻm 47 Bùi Đình Túy`, cách số 47 mặt đường khoảng 135 m. Với bán kính GPS 50 m, task phải lưu đúng tọa độ trong hẻm. Một địa chỉ hẻm có thể tốn tới 4 lần gọi API.
- Test: `src/modules/geocoding/service.test.js` (9 test, giả lập API bằng response thật). `test_folder/workflow.e2e.test.js` dùng địa chỉ `10 Nguyen Hue / Sai Gon`.

### 4.4 Flow test offline (`test_folder/`)

- `requester.flow.test.js`, `provider.flow.test.js`, cùng `support/platformHarness.js` gồm Prisma, Stripe và repository giả lập. Chạy bằng `npm run test:flows`.
- Khi ghép main mới, harness được bổ sung 2 hàm `hasProviderCompletionConfirmation` và `hasActiveDispute`.
- `package.json` thêm script `test:unit`, `test:flows`, `test:e2e`.

### 4.5 Test cờ fraud (2026-11-27)

Test chỉ dùng code đang có sẵn: `src/modules/tasks/riskEvaluator.js`, cùng `createTask`/`updateTask`/`toPublicTask` trong `tasks/service.js`.

- `src/modules/tasks/riskEvaluator.test.js`: 12 test (11 pass, 1 todo), nằm trong `npm run test:unit`.
- `test_folder/fraud.flow.test.js`: 13 test qua API thật (12 pass, 1 todo). Đã thêm file này vào `npm run test:flows`.

Lý do duy nhất khiến task bị gắn cờ là **ngân sách thấp hơn mức tối thiểu của danh mục**. Mức tối thiểu được nhân thêm khi tiêu đề hoặc mô tả có từ khóa:

| Danh mục | Tối thiểu (VND) |
|---|---|
| CLEANING | 250.000 |
| HOME_REPAIR | 350.000 |
| DELIVERY | 100.000 |
| MOVING | 700.000 |
| IT_SUPPORT | 300.000 |
| PERSONAL_ASSISTANT | 250.000 |
| TUTORING | 200.000 |
| OTHER (và danh mục lạ) | 200.000 |

| Từ khóa (có thể cộng dồn) | Hệ số | Lý do |
|---|---|---|
| deep clean, deep cleaning, full apartment, whole house | ×1,6 | Công việc nặng hơn dọn dẹp thường |
| fragile, glass, heavy, stairs, multiple floors | ×1,25 | Hàng dễ vỡ hoặc tốn sức |
| urgent, asap, today, tonight, immediately | ×1,2 | Việc gấp |
| install, replacement parts, materials included | ×1,3 | Cần vật tư hoặc linh kiện |

- Ngân sách dưới 50% mức tối thiểu là `HIGH`; từ 50% đến dưới 100% là `MEDIUM`. `suspiciousReason` lấy lý do của từ khóa đầu tiên khớp, không khớp từ khóa nào thì dùng câu chung.
- Cờ được tính lại mỗi khi requester sửa ngân sách, tiêu đề, mô tả hoặc danh mục. Kết quả được ghi vào activity log `TASK_CREATED`/`TASK_UPDATED`.
- Chỉ provider và admin thấy cờ; requester và khách chưa đăng nhập không thấy. Admin xem danh sách qua `GET /api/admin/tasks/suspicious`.

Hạn chế (đã ghi trong test):

- Cờ không chặn gì: task vẫn ở trạng thái `OPEN` và provider vẫn bid được.
- Không phát hiện ngân sách cao bất thường.
- Từ khóa so khớp theo chuỗi con ("glasses" khớp "glass", "reinstall" khớp "install") và chỉ có tiếng Anh. **todo:** "gấp", "hôm nay" không được nhận.
- **todo:** khi `PATCH /api/tasks/:id` đổi `siteAddress`/`siteLatitude`/`siteLongitude`, địa chỉ không được xác minh lại bằng geocoder và API vẫn trả 200.

## 5. Database `quang_testing`

Đã kiểm tra ngày 2026-11-27: project `polished-night-84339447`, branch `br-raspy-river-b3yyxzx2`, database `neondb`.

| Kiểm tra | Kết quả |
|---|---|
| `prisma migrate status` | 18/18 migration, "Database schema is up to date" |
| `prisma migrate diff` (DB so với `schema.prisma`) | Rỗng: cấu trúc bảng khớp hoàn toàn |
| Checksum migration | 18/18 khớp với file (12 file khác nhau chỉ ở CRLF) |
| Dữ liệu Location | 24 quận / 102 phường / 75 cặp giáp ranh; đủ 3 trigger |
| Dữ liệu | 11 user (`locationId` chưa được gán), 5 provider profile (đã gán district), 0 task |

**Không cần sửa bảng nào:** 5 commit mới của main không có migration, và `quang_testing` đã có cả 2 migration Location.

Khi thêm migration mới, chạy cả 2 lệnh dưới đây từ thư mục gốc MERGE. `.env` phải có `DATABASE_URL` và `DATABASE_URL_UNPOOLED` cùng trỏ vào `quang_testing`, vì `prisma.config.ts` ưu tiên `DATABASE_URL_UNPOOLED`.

```powershell
npx prisma migrate status
```

```powershell
npx prisma migrate deploy
```

**Không chạy `node database/prisma/seed-test-accounts.js`** trên `quang_testing`. Từ `5543c02`, seed chỉ chạy khi `NEON_BRANCH=e2e-test-20261122` và đúng branch ID `br-dry-truth-b30rzu08`, nên trên `quang_testing` script sẽ tự từ chối.

**Trước khi đưa về main:** DB dùng chung `e2e-test-20261122` mới có 16 migration. Phải áp thêm `20261121000000_user_location` và `20261125000000_location_tables`, nên cần báo nhóm trước.

## 6. Kết quả test (2026-11-27)

| Lệnh | Kết quả |
|---|---|
| `npm run test:unit` | 59/59 pass |
| `npm run test:flows` | 63 pass, **1 fail**, 2 todo |
| `frontend-web`: `npm run build` | OK |
| `frontend-mobile`: `npx jest` | 4/4 pass |

## 7. Lỗi và hạn chế còn lại

1. **Lỗi từ main (`6d27a56`), làm fail test P7.3:** admin xử lý tranh chấp với `action: RELEASE_ESCROW` nhận 409. `releaseEscrowForTask` chỉ cho release khi task ở `COMPLETED`/`HELD`, trong khi task đang tranh chấp ở `DISPUTED`/`FROZEN`, nên provider thắng tranh chấp không nhận được tiền. Cần báo dbao51.
2. **Rating** (2 test `todo`): rating chỉ cho phép khi task ở `COMPLETED`, nhưng release thành công thì task lên `PAID` ngay.
3. **Xác minh địa chỉ:**
   - Số nhà trên các đoạn đường đánh số trùng (ví dụ Trần Hưng Đạo ở Q1 và Q5) chỉ được nhận ở đoạn mà API chọn.
   - Đường trùng tên ngoài 102 phường (như Lái Thiêu) vẫn phải dựa vào kết quả có kèm phường.
   - Danh sách chưa có phường của Bình Dương và Bà Rịa – Vũng Tàu cũ.
   - Mỗi lần xác minh có thể gọi API 2 lần.
4. Bước kiểm tra provider đến đúng nơi chưa được chạy thực tế, vì cần escrow đã được nạp tiền qua Stripe. Bán kính đã giảm từ 1 km xuống **100 m** (`VERIFICATION_RADIUS_METERS` trong `src/modules/tracking/service.js`, đổi ngày 2026-11-27; trước đó có lúc để 50 m). Khi provider ở xa, thông báo không nêu khoảng cách: *"You are not at the job site yet. Move closer to the task address and try again."* Trên mobile, nút xác minh không còn ghi "(1 km)", và dòng "Requester task address" phía trên bản đồ không còn chớp tắt mỗi lần màn hình tải lại task.
5. Task seed không có `district`, nên provider thấy "District not provided". Lỗi này có từ main.

## 8. Biến môi trường (chỉ ghi tên, không ghi giá trị)

- Root `.env`: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH=quang_testing`, `GEOCODING_API_KEY`, `CLOUDINARY_*`, Stripe, JWT, ...
- `frontend-web/.env`: `VITE_CLOUDINARY_*`
- `frontend-mobile/.env`: `EXPO_PUBLIC_CLOUDINARY_*`, `EXPO_PUBLIC_API_URL`

Sau khi sửa `.env`: khởi động lại backend; web chạy lại `npm run dev`; mobile chạy `npx expo start -c`.
