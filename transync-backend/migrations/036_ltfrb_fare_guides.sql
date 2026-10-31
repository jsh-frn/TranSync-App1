-- System-wide, read-only LTFRB official fare reference documents (PDFs) —
-- one row per uploaded document, no owner (association/operator), and
-- deliberately no accompanying update/delete API: these are seeded once by
-- the developer and are never editable, replaceable, or deletable through
-- the application by any role (commuter/operator/driver/association/admin
-- alike). Bus has multiple official LTFRB documents (City vs Provincial,
-- Ordinary/Aircon/Deluxe/Super Deluxe/Luxury) while Jeepney and UV Express
-- each have exactly one — sort_order keeps a stable, sensible display order
-- within a vehicle_type when there's more than one.
CREATE TABLE IF NOT EXISTS ltfrb_fare_guides (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_type ENUM('Jeepney', 'UV Express', 'Bus') NOT NULL,
    label        VARCHAR(150) NOT NULL,
    file_path    VARCHAR(255) NOT NULL,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Labels use a plain ASCII hyphen, not an en-dash — this project's DB
-- connection (config/db.php) never calls set_charset(), so multi-byte
-- UTF-8 punctuation stored through it comes back mangled (confirmed live:
-- an en-dash round-tripped as "ÔÇô"). Sidestepped here rather than changing
-- the shared connection charset, which is a bigger, unrelated fix.
INSERT INTO ltfrb_fare_guides (vehicle_type, label, file_path, sort_order) VALUES
    ('Jeepney',    'Traditional PUJ Fare Guide',    'uploads/ltfrb_fare_guides/Fare-Guide_Traditional-PUJ-Provisional-Fare-Increase_08Oct2023.pdf', 1),
    ('UV Express', 'UV Express Fare Guide',         'uploads/ltfrb_fare_guides/UVE-Fare-Guide.pdf',                    1),
    ('Bus',        'City - Ordinary',               'uploads/ltfrb_fare_guides/PUB-City-Ordinary.pdf',                 1),
    ('Bus',        'City - Aircon',                 'uploads/ltfrb_fare_guides/PUB-City-Aircon.pdf',                   2),
    ('Bus',        'Provincial - Ordinary',          'uploads/ltfrb_fare_guides/PUB-Provincial-Ordinary.pdf',           3),
    ('Bus',        'Provincial - Aircon (Regular)',  'uploads/ltfrb_fare_guides/PUB-Provincial-Aircon.pdf',             4),
    ('Bus',        'Provincial - Deluxe',            'uploads/ltfrb_fare_guides/PUB-Provincial-Deluxe.pdf',             5),
    ('Bus',        'Provincial - Super Deluxe',      'uploads/ltfrb_fare_guides/PUB-Provincial-Super-Deluxe.pdf',       6),
    ('Bus',        'Provincial - Luxury',            'uploads/ltfrb_fare_guides/PUB-Provincial-Luxury.pdf',             7);
