-- Run once against the `transync` database.
-- Vehicle seat counts are now picked from a fixed list (12, 14, ..., 36 —
-- see vehicles.php), widening the top end from the original 32-seat cap.
-- Extend the Jeepney quota tiers so every possible seat count still resolves
-- to a tier (continuing the existing ~₱200-per-tier progression).
INSERT INTO jeepney_quota_tiers (min_capacity, max_capacity, quota_amount) VALUES
    (33, 36, 1700.00);
