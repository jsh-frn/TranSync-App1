-- Lets the admin panel replace the PDF behind an LTFRB fare guide category
-- (see migration 036) instead of it being permanently fixed at seed time.
-- The 9 category rows themselves (1 Jeepney, 1 UV Express, 7 Bus classes)
-- stay fixed — this only adds a real write path (reference/
-- update_ltfrb_fare_guide.php, admin-only) for swapping the underlying PDF,
-- plus a timestamp so the admin UI can show "last updated" per category.
ALTER TABLE ltfrb_fare_guides ADD COLUMN updated_at DATETIME NULL AFTER sort_order;
