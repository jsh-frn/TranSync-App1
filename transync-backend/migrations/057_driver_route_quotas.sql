-- Run once against the `transync` database.
-- New Vehicle Type -> Route -> Driver -> Daily Quota booking-capacity cap.
-- Deliberately a separate table from the existing `driver_quotas`
-- (a peso cash-settlement target a driver remits to the operator,
-- `transync-backend/sql/quota_tables.sql` — unique per driver, no route
-- dimension). This new table caps how many valid COMMUTER BOOKINGS a given
-- driver may take on a given route per calendar day; it never touches money
-- and is entirely independent of driver_quotas/quota_submissions.
--
-- No `quota_date` column: usage is always computed LIVE from `reservations`
-- (joined through `trips` for Bus, `boarding_driver_id` for UV Express),
-- scoped to a travel date — never stored/decremented — so a cancellation or
-- refund frees up the count automatically with no release/decrement logic
-- needed anywhere.

CREATE TABLE driver_route_quotas (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  operator_id  INT NOT NULL,
  route_id     INT NOT NULL,
  driver_id    INT NOT NULL,
  daily_quota  INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_route_driver_quota (route_id, driver_id),
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
  FOREIGN KEY (route_id)    REFERENCES routes(id)    ON DELETE CASCADE,
  FOREIGN KEY (driver_id)   REFERENCES drivers(id)   ON DELETE CASCADE
);
