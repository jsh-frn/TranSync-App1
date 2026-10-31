-- Run this in phpMyAdmin or MySQL CLI against the `transync` database
-- Adds a 'blank' seat_type — a non-bookable, non-selectable placeholder that
-- marks the aisle path itself in a generated layout (distinct from 'aisle',
-- which describes a real bookable seat next to the aisle). Never counted
-- toward vehicles.capacity; commuters can never select it (see Core Flow 13).

ALTER TABLE seats MODIFY COLUMN seat_type ENUM('window','aisle','sleeper','driver','conductor','blank') NOT NULL DEFAULT 'window';
ALTER TABLE bus_layout_template_seats MODIFY COLUMN seat_type ENUM('window','aisle','sleeper','driver','conductor','blank') NOT NULL DEFAULT 'window';
