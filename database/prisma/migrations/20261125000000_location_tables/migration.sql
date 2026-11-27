-- Normalised location tables: DISTRICTS (former district) -> LOCATIONS (new ward).
-- USERS/TASKS link to a ward, PROVIDER_PROFILES to a service district.
-- The old text columns stay, so the app keeps working; triggers keep the FKs in sync.

-- AlterTable
ALTER TABLE "USERS" ADD COLUMN     "locationId" INTEGER;

-- AlterTable
ALTER TABLE "PROVIDER_PROFILES" ADD COLUMN     "serviceDistrictId" INTEGER;

-- AlterTable
ALTER TABLE "TASKS" ADD COLUMN     "locationId" INTEGER;

-- CreateTable
CREATE TABLE "DISTRICTS" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Ho Chi Minh City',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DISTRICTS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LOCATIONS" (
    "id" SERIAL NOT NULL,
    "ward" TEXT NOT NULL,
    "districtId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LOCATIONS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DISTRICT_NEIGHBORS" (
    "districtId" INTEGER NOT NULL,
    "neighborId" INTEGER NOT NULL,

    CONSTRAINT "DISTRICT_NEIGHBORS_pkey" PRIMARY KEY ("districtId","neighborId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DISTRICTS_name_key" ON "DISTRICTS"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LOCATIONS_ward_key" ON "LOCATIONS"("ward");

-- CreateIndex
CREATE INDEX "LOCATIONS_districtId_idx" ON "LOCATIONS"("districtId");

-- CreateIndex
CREATE INDEX "USERS_locationId_idx" ON "USERS"("locationId");

-- CreateIndex
CREATE INDEX "PROVIDER_PROFILES_serviceDistrictId_idx" ON "PROVIDER_PROFILES"("serviceDistrictId");

-- CreateIndex
CREATE INDEX "TASKS_locationId_idx" ON "TASKS"("locationId");

-- AddForeignKey
ALTER TABLE "USERS" ADD CONSTRAINT "USERS_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LOCATIONS"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PROVIDER_PROFILES" ADD CONSTRAINT "PROVIDER_PROFILES_serviceDistrictId_fkey" FOREIGN KEY ("serviceDistrictId") REFERENCES "DISTRICTS"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TASKS" ADD CONSTRAINT "TASKS_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LOCATIONS"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LOCATIONS" ADD CONSTRAINT "LOCATIONS_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "DISTRICTS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DISTRICT_NEIGHBORS" ADD CONSTRAINT "DISTRICT_NEIGHBORS_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "DISTRICTS"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DISTRICT_NEIGHBORS" ADD CONSTRAINT "DISTRICT_NEIGHBORS_neighborId_fkey" FOREIGN KEY ("neighborId") REFERENCES "DISTRICTS"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed reference data ---------------------------------------------------------
INSERT INTO "DISTRICTS" ("name") VALUES
  ('District 1'),
  ('District 3'),
  ('District 4'),
  ('District 5'),
  ('District 6'),
  ('District 7'),
  ('District 8'),
  ('District 10'),
  ('District 11'),
  ('District 12'),
  ('Binh Thanh'),
  ('Go Vap'),
  ('Phu Nhuan'),
  ('Tan Binh'),
  ('Tan Phu'),
  ('Binh Tan'),
  ('Thu Duc'),
  ('Binh Chanh'),
  ('Hoc Mon'),
  ('Cu Chi'),
  ('Nha Be'),
  ('Can Gio'),
  ('District 2'),
  ('District 9')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "LOCATIONS" ("ward", "districtId")
SELECT v.ward, d."id" FROM (VALUES
  ('Sai Gon', 'District 1'),
  ('Tan Dinh', 'District 1'),
  ('Ben Thanh', 'District 1'),
  ('Cau Ong Lanh', 'District 1'),
  ('Ban Co', 'District 3'),
  ('Xuan Hoa', 'District 3'),
  ('Nhieu Loc', 'District 3'),
  ('Vinh Hoi', 'District 4'),
  ('Khanh Hoi', 'District 4'),
  ('Xom Chieu', 'District 4'),
  ('Cho Quan', 'District 5'),
  ('An Dong', 'District 5'),
  ('Cho Lon', 'District 5'),
  ('Binh Tay', 'District 6'),
  ('Binh Tien', 'District 6'),
  ('Binh Phu', 'District 6'),
  ('Phu Lam', 'District 6'),
  ('Tan Thuan', 'District 7'),
  ('Phu Thuan', 'District 7'),
  ('Tan My', 'District 7'),
  ('Tan Hung', 'District 7'),
  ('Chanh Hung', 'District 8'),
  ('Phu Dinh', 'District 8'),
  ('Binh Dong', 'District 8'),
  ('Dien Hong', 'District 10'),
  ('Vuon Lai', 'District 10'),
  ('Hoa Hung', 'District 10'),
  ('Minh Phung', 'District 11'),
  ('Binh Thoi', 'District 11'),
  ('Hoa Binh', 'District 11'),
  ('Phu Tho', 'District 11'),
  ('Trung My Tay', 'District 12'),
  ('Dong Hung Thuan', 'District 12'),
  ('Tan Thoi Hiep', 'District 12'),
  ('Thoi An', 'District 12'),
  ('An Phu Dong', 'District 12'),
  ('Gia Dinh', 'Binh Thanh'),
  ('Binh Thanh', 'Binh Thanh'),
  ('Binh Loi Trung', 'Binh Thanh'),
  ('Thanh My Tay', 'Binh Thanh'),
  ('Binh Quoi', 'Binh Thanh'),
  ('Hanh Thong', 'Go Vap'),
  ('An Nhon', 'Go Vap'),
  ('Go Vap', 'Go Vap'),
  ('Thong Tay Hoi', 'Go Vap'),
  ('An Hoi Tay', 'Go Vap'),
  ('An Hoi Dong', 'Go Vap'),
  ('Duc Nhuan', 'Phu Nhuan'),
  ('Cau Kieu', 'Phu Nhuan'),
  ('Phu Nhuan', 'Phu Nhuan'),
  ('Tan Son Hoa', 'Tan Binh'),
  ('Tan Son Nhat', 'Tan Binh'),
  ('Tan Hoa', 'Tan Binh'),
  ('Bay Hien', 'Tan Binh'),
  ('Tan Binh', 'Tan Binh'),
  ('Tan Son', 'Tan Binh'),
  ('Tay Thanh', 'Tan Phu'),
  ('Tan Son Nhi', 'Tan Phu'),
  ('Phu Tho Hoa', 'Tan Phu'),
  ('Phu Thanh', 'Tan Phu'),
  ('Tan Phu', 'Tan Phu'),
  ('An Lac', 'Binh Tan'),
  ('Binh Tan', 'Binh Tan'),
  ('Tan Tao', 'Binh Tan'),
  ('Binh Tri Dong', 'Binh Tan'),
  ('Binh Hung Hoa', 'Binh Tan'),
  ('Hiep Binh', 'Thu Duc'),
  ('Tam Binh', 'Thu Duc'),
  ('Thu Duc', 'Thu Duc'),
  ('Tang Nhon Phu', 'Thu Duc'),
  ('Phuoc Long', 'Thu Duc'),
  ('Long Phuoc', 'Thu Duc'),
  ('Long Truong', 'Thu Duc'),
  ('Linh Xuan', 'Thu Duc'),
  ('Long Binh', 'Thu Duc'),
  ('An Khanh', 'Thu Duc'),
  ('Binh Trung', 'Thu Duc'),
  ('Cat Lai', 'Thu Duc'),
  ('Vinh Loc', 'Binh Chanh'),
  ('Tan Vinh Loc', 'Binh Chanh'),
  ('Binh Loi', 'Binh Chanh'),
  ('Tan Nhut', 'Binh Chanh'),
  ('Binh Chanh', 'Binh Chanh'),
  ('Hung Long', 'Binh Chanh'),
  ('Binh Hung', 'Binh Chanh'),
  ('Dong Thanh', 'Hoc Mon'),
  ('Hoc Mon', 'Hoc Mon'),
  ('Xuan Thoi Son', 'Hoc Mon'),
  ('Ba Diem', 'Hoc Mon'),
  ('Tan An Hoi', 'Cu Chi'),
  ('Cu Chi', 'Cu Chi'),
  ('Thai My', 'Cu Chi'),
  ('An Nhon Tay', 'Cu Chi'),
  ('Nhuan Duc', 'Cu Chi'),
  ('Phu Hoa Dong', 'Cu Chi'),
  ('Binh My', 'Cu Chi'),
  ('Nha Be', 'Nha Be'),
  ('Hiep Phuoc', 'Nha Be'),
  ('Binh Khanh', 'Can Gio'),
  ('Can Gio', 'Can Gio'),
  ('An Thoi Dong', 'Can Gio'),
  ('Thanh An', 'Can Gio')
) AS v(ward, district) JOIN "DISTRICTS" d ON d."name" = v.district
ON CONFLICT ("ward") DO NOTHING;

INSERT INTO "DISTRICT_NEIGHBORS" ("districtId", "neighborId")
SELECT a."id", b."id" FROM (VALUES
  ('District 1', 'District 3'),
  ('District 1', 'District 4'),
  ('District 1', 'District 5'),
  ('District 1', 'Binh Thanh'),
  ('District 1', 'Phu Nhuan'),
  ('District 2', 'District 1'),
  ('District 2', 'District 9'),
  ('District 2', 'Thu Duc'),
  ('District 2', 'Binh Thanh'),
  ('District 3', 'District 1'),
  ('District 3', 'District 10'),
  ('District 3', 'Phu Nhuan'),
  ('District 3', 'Binh Thanh'),
  ('District 4', 'District 1'),
  ('District 4', 'District 7'),
  ('District 4', 'District 8'),
  ('District 5', 'District 1'),
  ('District 5', 'District 6'),
  ('District 5', 'District 10'),
  ('District 5', 'District 11'),
  ('District 6', 'District 5'),
  ('District 6', 'District 11'),
  ('District 6', 'Tan Phu'),
  ('District 6', 'District 8'),
  ('District 7', 'District 4'),
  ('District 7', 'District 8'),
  ('District 7', 'Nha Be'),
  ('District 8', 'District 4'),
  ('District 8', 'District 6'),
  ('District 8', 'District 7'),
  ('District 8', 'Binh Chanh'),
  ('District 9', 'District 2'),
  ('District 9', 'Thu Duc'),
  ('District 9', 'District 12'),
  ('District 10', 'District 3'),
  ('District 10', 'District 5'),
  ('District 10', 'District 11'),
  ('District 10', 'Tan Binh'),
  ('District 11', 'District 5'),
  ('District 11', 'District 6'),
  ('District 11', 'District 10'),
  ('District 11', 'Tan Phu'),
  ('District 12', 'Go Vap'),
  ('District 12', 'Tan Binh'),
  ('District 12', 'District 9'),
  ('District 12', 'Thu Duc'),
  ('Binh Thanh', 'District 1'),
  ('Binh Thanh', 'District 2'),
  ('Binh Thanh', 'District 3'),
  ('Binh Thanh', 'Phu Nhuan'),
  ('Binh Thanh', 'Go Vap'),
  ('Phu Nhuan', 'District 1'),
  ('Phu Nhuan', 'District 3'),
  ('Phu Nhuan', 'Binh Thanh'),
  ('Phu Nhuan', 'Tan Binh'),
  ('Phu Nhuan', 'Go Vap'),
  ('Go Vap', 'Phu Nhuan'),
  ('Go Vap', 'Binh Thanh'),
  ('Go Vap', 'District 12'),
  ('Go Vap', 'Tan Binh'),
  ('Tan Binh', 'Phu Nhuan'),
  ('Tan Binh', 'Go Vap'),
  ('Tan Binh', 'District 10'),
  ('Tan Binh', 'District 12'),
  ('Tan Binh', 'Tan Phu'),
  ('Tan Phu', 'Tan Binh'),
  ('Tan Phu', 'District 6'),
  ('Tan Phu', 'District 11'),
  ('Thu Duc', 'District 2'),
  ('Thu Duc', 'District 9'),
  ('Thu Duc', 'District 12'),
  ('Nha Be', 'District 7'),
  ('Nha Be', 'Binh Chanh'),
  ('Binh Chanh', 'District 8'),
  ('Binh Chanh', 'Nha Be')
) AS v(a, b) JOIN "DISTRICTS" a ON a."name" = v.a JOIN "DISTRICTS" b ON b."name" = v.b
ON CONFLICT DO NOTHING;

-- Lookup helpers: case/space-insensitive, ignore anything after the first comma
-- ("District 1, Ho Chi Minh City" -> "District 1").
CREATE OR REPLACE FUNCTION cmt_location_id(txt TEXT) RETURNS INTEGER AS $$
  SELECT "id" FROM "LOCATIONS" WHERE lower("ward") = lower(btrim(split_part(txt, ',', 1))) LIMIT 1
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION cmt_district_id(txt TEXT) RETURNS INTEGER AS $$
  SELECT COALESCE(
    (SELECT "id" FROM "DISTRICTS" WHERE lower("name") = lower(btrim(split_part(txt, ',', 1))) LIMIT 1),
    (SELECT "districtId" FROM "LOCATIONS" WHERE lower("ward") = lower(btrim(split_part(txt, ',', 1))) LIMIT 1)
  )
$$ LANGUAGE sql STABLE;

-- Backfill existing rows ------------------------------------------------------
UPDATE "USERS" SET "locationId" = cmt_location_id("location") WHERE "location" IS NOT NULL;
UPDATE "TASKS" SET "locationId" = COALESCE(cmt_location_id("location"), cmt_location_id("district"));
UPDATE "PROVIDER_PROFILES" SET "serviceDistrictId" = cmt_district_id("district") WHERE "district" IS NOT NULL;

-- Keep FKs in sync when the app writes the text columns -----------------------
CREATE OR REPLACE FUNCTION cmt_sync_user_location() RETURNS TRIGGER AS $$
BEGIN NEW."locationId" := cmt_location_id(NEW."location"); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cmt_sync_task_location() RETURNS TRIGGER AS $$
BEGIN NEW."locationId" := COALESCE(cmt_location_id(NEW."location"), cmt_location_id(NEW."district")); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cmt_sync_provider_district() RETURNS TRIGGER AS $$
BEGIN NEW."serviceDistrictId" := cmt_district_id(NEW."district"); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "USERS_sync_location" ON "USERS";
CREATE TRIGGER "USERS_sync_location" BEFORE INSERT OR UPDATE OF "location" ON "USERS"
  FOR EACH ROW EXECUTE FUNCTION cmt_sync_user_location();

DROP TRIGGER IF EXISTS "TASKS_sync_location" ON "TASKS";
CREATE TRIGGER "TASKS_sync_location" BEFORE INSERT OR UPDATE OF "location", "district" ON "TASKS"
  FOR EACH ROW EXECUTE FUNCTION cmt_sync_task_location();

DROP TRIGGER IF EXISTS "PROVIDER_PROFILES_sync_district" ON "PROVIDER_PROFILES";
CREATE TRIGGER "PROVIDER_PROFILES_sync_district" BEFORE INSERT OR UPDATE OF "district" ON "PROVIDER_PROFILES"
  FOR EACH ROW EXECUTE FUNCTION cmt_sync_provider_district();
