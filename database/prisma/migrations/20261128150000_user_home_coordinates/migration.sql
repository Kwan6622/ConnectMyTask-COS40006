-- Map point of the private home address (geocoded when the profile is saved),
-- used to rank task suggestions by distance. Null when the address could not be
-- found; the ward centre is used instead. Never returned to other users.
ALTER TABLE "USERS" ADD COLUMN "homeLatitude" DOUBLE PRECISION,
  ADD COLUMN "homeLongitude" DOUBLE PRECISION;
