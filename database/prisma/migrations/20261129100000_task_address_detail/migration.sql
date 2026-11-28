-- Private address details typed by the requester when posting a task (max 100
-- characters): apartment / floor / block, or the exact address when the map
-- cannot find the house and a nearby address was verified instead. Shown only
-- to the hired provider once escrow is funded.
ALTER TABLE "TASKS" ADD COLUMN "addressDetail" VARCHAR(100);
