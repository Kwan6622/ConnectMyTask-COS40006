# MERGE-CMT — Ghi chú thay đổi

Cập nhật: 2026-11-29 · Branch git: `merge-test-features` · DB: Neon branch `quang_testing`

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
- **Đã thay bằng mục 4.5c** (2026-11-28): bỏ quận, bảng và trigger ở trên đã được xóa.

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

### 4.5a Subtask tự hoàn thành theo tiến độ (2026-11-27)

- `createTaskProgressUpdate` (`src/modules/tasks/service.js`): khi provider cập nhật tiến độ X%, mọi subtask chưa xong có mốc `progressPercent` ≤ X% sẽ tự chuyển `DONE`. Mỗi subtask được ghi một dòng activity `SUBTASK_STATUS_UPDATED`, metadata có `automatic: true`. Response trả thêm `autoCompletedSubtasks`.
- `updateTaskSubtaskStatus`: subtask đã `DONE` không mở lại được (trả 409); gửi `DONE` lần nữa thì không có tác dụng gì.
- Mobile (`app/task-progress.tsx`) và web (`TaskProgressPage.tsx`): subtask đã xong được làm mờ, gạch ngang, ghi "Completed" và không còn nút. Mobile chỉ hiện nút "Start" khi subtask còn `PENDING`.
- Test: P6.2a và P6.2b trong `test_folder/provider.flow.test.js`.

### 4.5b Khóa panel cập nhật khi đã báo hoàn thành, bỏ ngày dự kiến (2026-11-28)

- Backend (`src/modules/tasks/service.js`): hàm mới `assertProgressNotLocked`. Khi task ở `PENDING_CONFIRMATION`, `COMPLETED` hoặc `AWAITING_PAYMENT`, cả cập nhật tiến độ lẫn cập nhật subtask đều trả 409 "This task has already been published as completed...". Trước đây `PENDING_CONFIRMATION` vẫn cho cập nhật.
- Web và mobile: panel "Provider Update Panel" vẫn hiện nhưng bị khóa (mờ, không nhập được), có dòng báo đã hoàn thành, nút đổi thành "Published as completed". Nút bình thường ghi "Publish", chỉ hiện "Publishing..." khi đang chờ backend.
- Bỏ trường `estimatedCompletionDate` (ngày dự kiến hoàn thành) khỏi form, phần tóm tắt, lịch sử cập nhật, TaskDetailPage, validation, repository và type. Thời điểm hoàn thành đã được ghi vào activity log khi provider báo xong. Client cũ còn gửi trường này vẫn được chấp nhận, backend chỉ bỏ qua.
- Migration mới `20261128120000_drop_progress_estimated_completion_date`: xóa cột `TASK_PROGRESS_UPDATES.estimatedCompletionDate`. Đã áp lên `quang_testing` (19/19, diff rỗng). Cột ETA của bid (`estimatedCompletionTime`) giữ nguyên.
- Test: P6.3b và P6.3c trong `test_folder/provider.flow.test.js`.

### 4.5c Thành phố → Phường, bỏ quận, địa chỉ gần nhà (2026-11-28)

Từ 1/7/2025 Việt Nam chỉ còn 2 cấp (tỉnh/thành → phường/xã), không còn quận. App đổi theo đúng mô hình này.

**Dữ liệu phường/xã**
- Nguồn: provinces.open-api.vn API v2 (danh sách sau sáp nhập). Lưu ở `src/shared/administrativeUnits.json`; làm mới bằng `node database/scripts/fetch-administrative-units.js`.
- TP. Hồ Chí Minh: 168 đơn vị (113 phường, 54 xã, 1 đặc khu Côn Đảo). Hà Nội: 126 đơn vị (51 phường, 75 xã).
- Mã định danh là **mã phường chính thức** (vd. Phường Bến Thành = 26743), mã thành phố là mã tỉnh (79 = HCM, 1 = Hà Nội). Mọi branch DB và mọi client dùng cùng một số, không lệ thuộc id tự tăng.
- Có tên trùng (HCM có cả "Xã Thanh An" và "Xã Thạnh An"; "Thuận An", "An Khánh" có ở cả 2 thành phố), nên luôn chọn theo mã, không theo tên.
- **Tên tiếng Anh** (migration `20261128140000_english_ward_names`, đã áp lên `quang_testing`, 21/21): app hoàn toàn tiếng Anh nên tên phường/xã bỏ dấu và bỏ chữ Phường/Xã/Đặc khu, vd. "Phường Bình Thạnh" thành "Binh Thanh"; loại đơn vị nằm ở cột `type` và hiện là Ward / Commune / Special zone. "Ha Noi" đổi thành "Hanoi". 2 xã trùng tên ở HCM thành "Thanh An (Dau Tieng)" và "Thanh An (Can Gio)". Xóa cột `LOCATIONS.shortName`, `CITIES.nameVi`. Người dùng vẫn gõ có dấu được, ô gợi ý vẫn tìm ra.
- API danh sách phường trước đây cho trình duyệt cache 1 ngày, nên có người vẫn thấy tên cũ có dấu ("Xã Dầu Tiếng"). Giờ trả `Cache-Control: no-cache` kèm ETag, đổi tên là thấy ngay.
- Địa chỉ đã xác minh của task (`siteAddress`) lưu không dấu bằng `toEnglishAddress` trong geocoding, vd. "47/24 Hem 47 Bui Dinh Tuy, Binh Thanh, Ho Chi Minh, Vietnam". 2 task cũ trên `quang_testing` đã được đổi.
- Script lấy dữ liệu viết chữ tiếng Việt dạng mã escape, nên code không còn chữ tiếng Việt (trừ comment và dữ liệu mẫu trong test geocoding, vì nhà cung cấp bản đồ trả về tiếng Việt).
- **Địa chỉ thật cho 11 user trên `quang_testing`** (2026-11-28): mỗi user một địa chỉ thật ở TP.HCM, chọn ngẫu nhiên từ 13 địa chỉ đã xác minh qua geocoder (vd. 135 Nam Ky Khoi Nghia, Ben Thanh; 7 Cong Truong Lam Son, Sai Gon; 720A Dien Bien Phu, Thanh My Tay; 469 Nguyen Huu Tho, Tan Hung). Điền `streetAddress`, `locationId`, `location`. Đây là dữ liệu test, không có migration.

**Database: migration `20261128130000_city_ward_locations`**
- Bảng mới `CITIES`. `LOCATIONS` giờ chứa toàn bộ 294 phường/xã với `cityId`, `name` ("Phường Bến Thành"), `shortName` ("Bến Thành"), `type` (ward / commune / special_zone).
- 102 phường cũ được đổi id sang mã chính thức; khóa ngoại `USERS.locationId`, `TASKS.locationId` tự đổi theo (ON UPDATE CASCADE), nên dữ liệu cũ giữ nguyên phường.
- Xóa: bảng `DISTRICTS`, `DISTRICT_NEIGHBORS`; cột `TASKS.district`, `PROVIDER_PROFILES.district`, `PROVIDER_PROFILES.serviceDistrictId`; 3 trigger và 5 hàm đồng bộ cũ.
- Thêm: `USERS.streetAddress` (địa chỉ nhà, riêng tư) và `TASKS.isApproximateLocation`.
- Đã áp lên `quang_testing`: 20/20 migration, diff với `schema.prisma` rỗng; 168 + 126 phường; 2 task cũ vẫn giữ phường.

**Backend**
- API công khai: `GET /api/locations/cities`, `GET /api/locations/cities/:cityId/wards`.
- Đăng ký, sửa hồ sơ, đăng task và sửa task nhận `wardId` (mã phường). Phường không có trong danh sách bị từ chối (400). Cột `location` chỉ còn là chữ hiển thị "Bến Thành, Ho Chi Minh City", backend tự điền.
- Xác minh địa chỉ theo `wardId`, hỗ trợ cả Hà Nội (gửi "…, Ha Noi, Vietnam"). Khi không tìm thấy địa chỉ, lỗi trả thêm `code: "ADDRESS_NOT_FOUND"`; `errorHandler` giờ trả `code` cho mọi lỗi 4xx có code dạng chuỗi.
- Gợi ý task cho provider: cùng phường +50, cùng thành phố +15 (thay cho bảng quận kề nhau). Xếp hạng phường lân cận để dành cho tính năng recommend.
- Task ở địa chỉ gần nhà: đăng với `isApproximateLocation: true` cần hồ sơ có địa chỉ nhà, nếu không trả 400 `PROFILE_ADDRESS_REQUIRED`. Địa chỉ nhà thật chỉ xuất hiện ở `GET /api/tracking/tasks/:id/site-location` (trường `requesterAddress`), tức là chỉ cho người trong task sau khi đã nạp escrow. Kiểm tra GPS vẫn dùng địa chỉ gần nhà đã xác minh (bán kính 100 m).
- Sửa lỗ hổng cũ: `GET /api/providers/:id/reviews` trả nguyên dòng user của người review (cả `passwordHash`) và nguyên task (cả địa chỉ chính xác). Giờ chỉ trả id, tên, ảnh và id, tiêu đề, loại task.
- Seed (`seed.js`, `seed-test-accounts.js`) đổi sang phường. Xóa `districtAdjacency.js`, `hoChiMinhWards.js` (backend, web, mobile).

**Web và mobile**
- Ô chọn mới `CityWardPicker`: chọn thành phố (HCM, Hà Nội) trước, rồi gõ tên phường; danh sách gợi ý phường gần đúng nhất (gõ có dấu hay không dấu đều được). Chỉ lưu được khi đã chọn một phường trong danh sách.
- Dùng ở: đăng ký (web có 2 form), hồ sơ, đăng task, bộ lọc tìm task (web, lọc theo thành phố hoặc phường).
- Hồ sơ có thêm "Home address (private)". Khung "Provider Trust" bỏ ô District, Address, City.
- Đăng task: nếu địa chỉ không tìm thấy, hiện khung vàng hướng dẫn nhập một địa chỉ tìm được trong vòng 100 m, bật công tắc "địa chỉ gần nhà", và có nút thêm câu ghi chú vào mô tả. Thẻ task và trang chi tiết hiện nhãn "Nearby address (within 100 m)". Provider được giao (sau khi nạp escrow) thấy "Requester's home (job location)".
- Mọi chữ "District" trong giao diện đổi thành thành phố/phường.

**Test**: R1.5, R9.1 – R9.5 (requester flow), P1.2, P2.1, P2.3, P2.4 (provider flow), 2 test Hà Nội và mã phường sai (geocoding), test escrow cho vị trí công khai.

### 4.5d Gợi ý task theo khoảng cách (2026-11-28)

Không cần train AI: mỗi task đã có tọa độ chính xác, mỗi phường có tọa độ tâm, nên "gần" là khoảng cách đường chim bay (km). Cách này chính xác, giải thích được và không tốn chi phí chạy model.

- **Tâm phường**: cả 294 phường/xã có `lat`, `lng` trong `src/shared/administrativeUnits.json`, lấy từ geocoder bằng `node database/scripts/geocode-ward-centers.js` (thêm `--all` để làm lại tất cả). Script chỉ nhận điểm nằm trong khung thành phố và có tên trùng phường (geocoder từng trả "Hung Dao" khi hỏi "Dai Thanh"). Riêng các phường của Bình Dương, Bà Rịa-Vũng Tàu cũ geocoder chỉ ghi nhãn chung nhưng điểm vẫn đúng. Phu Luong (Hà Nội) cần gợi ý "Ha Dong"; Ung Hoa (Hà Nội) ghi tay. `fetch-administrative-units.js` giữ lại tọa độ khi làm mới danh sách.
- **Migration `20261128150000_user_home_coordinates`**: thêm `USERS.homeLatitude`, `USERS.homeLongitude` (riêng tư). Khi lưu hồ sơ có đổi phường hoặc địa chỉ nhà, backend geocode địa chỉ nhà; nếu không tìm thấy vẫn lưu, tọa độ để trống và dùng tâm phường. Đã áp lên `quang_testing` (22/22) và điền tọa độ thật cho 11 user.
- **Xếp hạng** (`src/modules/tasks/nearby.js`, dùng trong `listSuggestedTasksForProvider`): điểm = chuyên môn (0 / 80 / 100) + khoảng cách (60 × e^(−km/4): 60 ở 0 km, ~36 ở 2 km, ~22 ở 4 km, ~8 ở 8 km) + trạng thái (OPEN 20, BIDDING 16, …). Điểm provider = nhà, nếu không có thì tâm phường; điểm task = địa chỉ đã xác minh, nếu không có thì tâm phường. Cùng điểm thì task gần hơn đứng trước. Thay cho cách cũ (cùng phường +50, cùng thành phố +15).
- **Hiển thị**: mỗi task gợi ý có `distanceKm`, làm tròn 0,5 km (tối thiểu 0,5) để không suy ra được địa chỉ chính xác trước khi được thuê. Web và mobile hiện "About 2.5 km away" / "Under 1 km away". Trang Browse (web) ở chế độ Suggested giữ đúng thứ tự server, không sắp xếp lại.
- **Test**: `src/modules/tasks/nearby.test.js` (6 test: mọi phường có tâm trong thành phố, khoảng cách hợp lý, điểm giảm dần, dùng nhà rồi mới tới tâm phường, làm tròn); P2.4 (gần trước: Ben Thanh, Sai Gon, Thu Dau Mot, Hoan Kiem), P2.5 (dùng nhà khi tìm được, không tìm được vẫn lưu và dùng tâm phường, không lộ ra hồ sơ công khai). Harness geocode trả tâm phường thay cho một điểm cố định.

### 4.5e Warning tài khoản và task EXPIRED (2026-11-28)

**Migration `20261128160000_warnings_and_expired_tasks`** (đã áp lên `quang_testing`, 23/23, diff rỗng):
- `USERS.warningCount` (mặc định 0), `USERS.lockedUntil`. `USERS.status` có thêm giá trị `LOCKED`. Cột `lockoutUntil` cũ (khóa 10 giây khi sai mật khẩu nhiều lần) không liên quan.
- Bảng mới `USER_WARNINGS`: mỗi lần cộng/trừ warning (`change`, `countAfter`, `reason`, `taskId`, `createdById` = admin hoặc null = hệ thống).
- `TaskStatus` thêm `EXPIRED`; `TASKS.expiredAt`.

**Warning** (`src/modules/users/warnings.js`, `warningRepository.js`)
- Đủ 3 warning: `status = LOCKED`, khóa 3 ngày (`lockedUntil`). User và provider đều áp dụng; admin không nhận warning.
- Đăng nhập khi đang khóa: 403 `code: ACCOUNT_LOCKED` kèm `lockedUntil`, `warningCount`, `reasons`. Middleware `authenticate` chặn luôn cả phiên đang mở.
- Tự mở khóa khi hết giờ (kiểm tra lúc đăng nhập, mỗi request, và khi admin mở danh sách user), hoặc admin bấm Reactivate. Cả hai cách đều đưa warning về 0 và ghi lịch sử. Admin giảm warning xuống dưới 3 thì cũng mở khóa.
- API admin: `GET /api/admin/users/:id/warnings`, `POST /api/admin/users/:id/warnings` (`change` 1 hoặc -1, `reason` bắt buộc). `GET /api/users/me` trả thêm `warningLimit`, `warnings`.
- Mỗi lần thay đổi đều gửi notification cho user.

**Task EXPIRED** (`src/modules/tasks/expiry.js`)
- Task OPEN/BIDDING quá `dueDate` mà chưa assign → `EXPIRED`, đóng các bid đang chờ, ghi activity `TASK_EXPIRED`. Chạy mỗi khi có người mở danh sách task, chi tiết task, task của requester hoặc gợi ý.
- Không có bid: báo requester sửa lại và đăng lại (gợi ý tăng ngân sách, cho thêm thời gian, thêm ảnh) hoặc xóa.
- Có bid mà không assign trước deadline: requester **+1 warning**, provider đã bid được báo.
- Công bằng: nếu thời gian nhận bid (24 giờ) kết thúc trước deadline thì hệ thống tự chọn bid tốt nhất như cũ, task không bị EXPIRED và không có warning.
- Task EXPIRED bị gỡ khỏi Browse và Suggested; chỉ người đăng và admin mở được (người khác nhận 404). Provider không bid được task đã quá deadline.
- API cho requester: `GET /api/tasks/:id/repost-suggestions` (gợi ý: ngân sách theo giá thường gặp, deadline mới +5 ngày, tiêu đề/mô tả rõ hơn, thêm ảnh, cho nhiều bid hơn, nhắc assign nếu lần trước có bid), `PATCH /api/tasks/:id/repost` (deadline mới bắt buộc ở tương lai, chấm lại điểm rủi ro, task về OPEN), `DELETE /api/tasks/:id/permanent` (xóa khỏi DB cùng bid, subtask, activity, notification; từ chối nếu có thanh toán, tranh chấp hoặc đánh giá).

**Web và mobile**
- Trang/màn hình khóa (`/account-locked`): không có menu, chỉ có Log out; hiện giờ mở khóa, thời gian còn lại và lý do.
- Profile: khung "Account warnings x/3" kèm lý do.
- Admin: cột warning, nút + / − warning (nhập lý do; mobile nhập ngay dưới user vì Android không có hộp nhập), lịch sử, Reactivate cho tài khoản bị khóa.
- Requester Dashboard (web) và My Posted Tasks (mobile): mục "Expired tasks" riêng; trang "Edit & repost" có gợi ý áp dụng bằng một nút, sửa nội dung, ảnh, deadline mới, nút đăng lại và nút xóa vĩnh viễn. Trang chi tiết task hết hạn có nút dẫn tới đó.

**Đồng bộ web và mobile**: đã so sánh các tính năng làm trong ngày; sửa 3 chỗ lệch: mobile Browse thêm lọc thành phố/phường, chi tiết task mobile thêm nhãn "Nearby address", trang chi tiết task hết hạn (cả hai bên) có nút "Edit & repost".

**Test**: `test_folder/warnings.flow.test.js` (W1–W5 warning và khóa, E1–E6 task hết hạn), đã thêm vào `npm run test:flows`.

### 4.5f Màu trạng thái, task bị hủy, sửa escrow (2026-11-28)

**Task bị hủy chỉ xem được**
- Web (Provider Dashboard, trang chi tiết task, Requester Dashboard) và mobile (chi tiết task, My Posted Tasks, Task Progress): task CANCELLED hoặc EXPIRED không còn nút Update Progress / Track Progress / khung theo dõi tiến độ, chỉ còn View Task.
- Mobile chi tiết task có 2 nút tiến độ trùng nhau, đã gộp còn 1.

**Một bảng màu cho mọi trạng thái**
- Web: `frontend-web/src/utils/statusColors.ts` (`taskStatusTone`, `taskStatusClasses`, `moneyStatusClasses`). Mobile: `getStatusVariant`, `getMoneyStatusVariant`, `variantColors`, `isViewOnlyTask` trong `frontend-mobile/src/utils/taskUtils.ts`.
- Đỏ: Cancelled, Failed. Vàng: Pending confirmation, Awaiting payment, escrow Pending deposit, payment Pending, chứng chỉ Pending. Xanh lá: Paid, Completed, escrow Held / Released. Xanh dương: Open, Bidding (Bidding không còn vàng). Tím: In progress. Hồng: Disputed. Xám: Expired.
- Áp dụng: thẻ task, trang chi tiết, trang tiến độ, các dashboard, lịch sử giao dịch, danh sách admin (web và mobile). Trước đây provider dashboard không có màu cho Cancelled nên hiện xám.

**Escrow "vẫn đang giữ" sau khi đã trả**
- Task "Fix leaking kitchen sink" đã tự release đúng lúc requester xác nhận (800.000 đ cho provider, 200.000 đ phí). Lỗi là dòng giao dịch DEPOSIT gốc vẫn ghi HELD, nên admin thấy 1.000.000 đ đang giữ và có nút Release.
- Sửa: khi release hoặc refund, dòng DEPOSIT được cập nhật thành RELEASED / REFUNDED. Admin chỉ đếm tiền đang giữ khi task thật sự còn HELD; doanh thu chỉ tính từ dòng ESCROW_RELEASE (không đếm phí 2 lần).
- Đã sửa dữ liệu cũ trên `quang_testing` (giao dịch #1). Test trong R4 kiểm tra dòng deposit được đánh dấu released.

**Thanh điều hướng**: bỏ "Task Progress" trùng lặp (web: trùng trang My Posted Tasks; mobile provider: trùng "My Assigned Tasks"). Requester trên mobile vẫn giữ vì là màn hình khác.

### 4.5g Admin dashboard (2026-11-28 → 29)

- **Badge trên tab**: số đỏ góc trên phải cho việc cần xử lý: Users = tài khoản đang bị khóa, Tasks = task bị gắn cờ chưa review, Certificates = chờ duyệt, Payments = escrow bị đóng băng hoặc task đã xác nhận mà chưa trả, Disputes = đang mở, Support = ticket đang mở. Overview không có badge. Lấy từ `attention` trong `GET /api/admin/stats`.
- **Certificates**: chia "Waiting for review" (có nút Verify / Reject) và "Reviewed" (có màu trạng thái, người duyệt, thời gian). Trước đây cả 6 chứng chỉ đều có nút nên trông như 6 cái đang chờ; thực tế chỉ 2.
- **Users**: lọc theo tên/email, vai trò, thành phố (Ho Chi Minh City / Hanoi / chưa chọn). Mỗi user hiện thành phố – phường, điểm đánh giá trung bình nhận được (số sao và số lượt, tính từ bảng ratings), và với provider là các tài liệu đã được xác minh (bấm để mở).
- **Task bị gắn cờ**: hiện nhãn HIGH / MEDIUM RISK, ngân sách, trạng thái, nhãn "Reviewed"; có nút "Open task".
- **Remove task (trước là Soft Delete)**: bắt buộc nhập lý do (5–500 ký tự); task bị ẩn và chuyển CANCELLED (lý do lưu vào `cancellationReason`), các bid đang chờ bị đóng, requester và mọi provider đã bid (cả provider được giao nếu có) nhận thông báo kèm lý do, ghi activity `TASK_REMOVED_BY_ADMIN`. Vẫn chặn khi escrow đang giữ / đóng băng hoặc đang tranh chấp. Mobile nhập lý do ngay dưới task (Android không có hộp prompt).
- **Mark Reviewed** giữ nguyên: chỉ đánh dấu admin đã xem, provider vẫn thấy cảnh báo, badge giảm 1.

### 4.5h Browse, trang chủ, cảnh báo rủi ro (2026-11-29)

- **Chỉ duyệt được task đang mở**: bộ lọc trạng thái ở trang chủ, Browse (web) và Browse (mobile) chỉ còn Open / Bidding. Backend `listTasks` chỉ trả OPEN / BIDDING chưa có người nhận; hỏi trạng thái khác trả danh sách rỗng (test P8.1).
- **Thẻ task**: Browse dùng cùng bố cục 2 cột như trang chủ, mọi thẻ cùng kích thước (516 × 369 px ở màn hình desktop); nút View luôn ở đáy thẻ.
- **Trang chủ**: thêm "Browse more →" cạnh "Showing N tasks".
- **Phân trang**: Previous và Next cùng độ rộng (web 112 px, mobile tối thiểu 96).
- **Cảnh báo rủi ro**: trang chi tiết task (web và mobile) hiện khung "Proceed with caution" với nhãn HIGH RISK (đỏ) hoặc MEDIUM RISK, lời khuyên và lý do; thẻ task hiện "HIGH RISK". Chỉ provider và admin thấy (backend không gửi trường rủi ro cho người khác).
- **Dữ liệu test**: 3 task OPEN cho requester3@gmail.com (Le Quynh Nhu): #8 "Deep clean whole house before Tet" 150.000 đ (HIGH), #9 "Move fragile glass cabinet up the stairs today" 200.000 đ (HIGH), #10 tutoring 300.000 đ (không gắn cờ). Tạo bằng luồng createTask thật nhưng không gọi geocoding API (dùng tọa độ đã xác minh trước đó) và không gọi AI (subtask theo mẫu); cờ rủi ro từ `riskEvaluator` có sẵn.

### 4.5i Address details khi đăng task (2026-11-29)

- **Migration `20261129100000_task_address_detail`**: cột `TASKS.addressDetail` VARCHAR(100), riêng tư. Đã áp lên `quang_testing` (24/24, diff rỗng).
- **Form Post Task (web và mobile)**: ô "Address details (optional)" dưới địa chỉ, nhiều dòng (3 dòng), tối đa 100 ký tự, có bộ đếm, cho căn hộ / tầng / block.
- **Khi không tìm thấy địa chỉ**: khung vàng gọn "Not found on the map. Enter a nearby address within 100 m (e.g. the alley entrance) to verify, and put your exact address in Address details." Khi địa chỉ gần đó xác minh được, form tự bật chế độ "nearby address" (có ô tick để bỏ): ô chi tiết đổi thành "Exact address *" và bắt buộc.
- **Không còn bắt buộc địa chỉ nhà trong profile**: backend chấp nhận nearby address nếu có `addressDetail`; task cũ không có chi tiết vẫn dùng địa chỉ profile (`EXACT_ADDRESS_REQUIRED` khi thiếu cả hai).
- **Riêng tư**: `addressDetail` bị bỏ khỏi mọi phản hồi task và danh sách admin; chỉ provider được giao thấy trong `GET /api/tracking/tasks/:id/site-location` sau khi nạp escrow ("Exact address (job location)" hoặc "Address details" trên bản đồ theo dõi web và mobile).
- **Bố cục web**: cột trái (Category, Deadline) và cột phải (Task location) độc lập, nên phần địa chỉ dài ra không kéo giãn cột Category hay đẩy Deadline xuống.
- Test: R10.1, R10.2, R9.4 (cập nhật).

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
| `prisma migrate status` | 24/24 migration (2026-11-29), "Database schema is up to date" |
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

## 6. Kết quả test (2026-11-29)

| Lệnh | Kết quả |
|---|---|
| `npm run test:unit` | 80 pass, 1 todo |
| `npm run test:flows` (requester, provider, fraud, warnings) | 99 pass, **1 fail** (P7.3), 3 todo |
| `frontend-web`: `npm run build` | OK |
| `frontend-mobile`: `npx jest` | 4/4 pass |

## 7. Lỗi và hạn chế còn lại

1. **Lỗi từ main (`6d27a56`), làm fail test P7.3:** admin xử lý tranh chấp với `action: RELEASE_ESCROW` nhận 409. `releaseEscrowForTask` chỉ cho release khi task ở `COMPLETED`/`HELD`, trong khi task đang tranh chấp ở `DISPUTED`/`FROZEN`, nên provider thắng tranh chấp không nhận được tiền. Cần báo dbao51.
2. **Rating** (2 test `todo`): rating chỉ cho phép khi task ở `COMPLETED`, nhưng release thành công thì task lên `PAID` ngay.
3. **Xác minh địa chỉ:**
   - Số nhà trên các đoạn đường đánh số trùng (ví dụ Trần Hưng Đạo ở Q1 và Q5) chỉ được nhận ở đoạn mà API chọn.
   - Đường trùng tên ở nơi khác vẫn phải dựa vào kết quả có kèm phường.
   - Gói geocoding (distancematrix) có giới hạn lượt gọi; ngày 2026-11-28 đã hết lượt sau khi lấy tâm 294 phường, lúc đó đăng task không xác minh được địa chỉ.
   - Mỗi lần xác minh có thể gọi API 2 lần.
4. Bước kiểm tra provider đến đúng nơi chưa được chạy thực tế, vì cần escrow đã được nạp tiền qua Stripe. Bán kính đã giảm từ 1 km xuống **100 m** (`VERIFICATION_RADIUS_METERS` trong `src/modules/tracking/service.js`, đổi ngày 2026-11-27; trước đó có lúc để 50 m). Khi provider ở xa, thông báo không nêu khoảng cách: *"You are not at the job site yet. Move closer to the task address and try again."* Trên mobile, nút xác minh không còn ghi "(1 km)", và dòng "Requester task address" phía trên bản đồ không còn chớp tắt mỗi lần màn hình tải lại task.
5. (Đã hết) Quận đã bỏ hoàn toàn; task hiện "Phường, Thành phố" (xem 4.5c).
6. Sau mỗi migration mới phải dừng backend rồi chạy `npx prisma generate` (backend đang chạy khóa file engine của Prisma trên Windows).

## 8. Biến môi trường (chỉ ghi tên, không ghi giá trị)

- Root `.env`: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH=quang_testing`, `GEOCODING_API_KEY`, `CLOUDINARY_*`, Stripe, JWT, ...
- `frontend-web/.env`: `VITE_CLOUDINARY_*`
- `frontend-mobile/.env`: `EXPO_PUBLIC_CLOUDINARY_*`, `EXPO_PUBLIC_API_URL`

Sau khi sửa `.env`: khởi động lại backend; web chạy lại `npm run dev`; mobile chạy `npx expo start -c`.
