-- Run once against the `transync` database.
-- Per-association operator wallets: an operator can now hold the same
-- vehicle type approved at multiple associations at once (migration 030),
-- so a single flat operators.wallet_balance can no longer represent "how
-- much this operator has earned/owes at association X" — money from DAU
-- and Angeles City JODA would sit in one indistinguishable pile.
--
-- operators.wallet_balance is NOT migrated or zeroed — it is frozen in
-- place as the "Legacy" bucket (whatever the operator had accumulated
-- before this split existed). It is never credited by any code path again
-- after this migration; it remains readable/withdrawable via a dedicated
-- legacy path in wallet/operator_wallet.php + operator_withdraw.php. This
-- is a deliberate choice — most historical wallet_transactions rows can't
-- be reliably re-attributed to one specific association (Jeepney quota
-- settlements in particular never captured a vehicle/route at all), so we
-- don't pretend otherwise by guessing a split.

CREATE TABLE operator_association_wallets (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    operator_id    INT NOT NULL,
    association_id INT NOT NULL,
    balance        DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_operator_association (operator_id, association_id),
    FOREIGN KEY (operator_id)    REFERENCES operators(id)    ON DELETE CASCADE,
    FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bus/UV Express remittance (config/remittance.php's creditRemittanceSplit)
-- derives association_id live per-transaction from the reservation's own
-- route (routes.association_id — always unambiguous, regardless of which
-- vehicle/driver ends up fulfilling a pooled UV Express slot), so no new
-- column is needed on `reservations` for that path.

-- Jeepney driver-quota settlement (quota_submissions/driver_quotas) has no
-- route or vehicle reference anywhere in its data model — it's a flat
-- driver-to-operator cash report. association_id is captured going forward
-- from the driver's *current* vehicle (drivers.vehicle_id -> vehicles.association_id)
-- at the moment a quota is set or a submission is made; NULL means it
-- couldn't be determined (e.g. driver had no vehicle assigned at that
-- moment) and settles through the operator's Legacy bucket instead.
ALTER TABLE quota_submissions
  ADD COLUMN association_id INT NULL AFTER driver_id,
  ADD CONSTRAINT fk_quota_submissions_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE SET NULL;

ALTER TABLE driver_quotas
  ADD COLUMN association_id INT NULL AFTER driver_id,
  ADD CONSTRAINT fk_driver_quotas_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE SET NULL;

-- So the operator wallet's TRANSACTION LIST can be scoped per association
-- too, not just the balance — otherwise switching workspace would show a
-- correctly-split balance sitting above a still-mixed history, which
-- defeats the point. NULL for every non-operator-credit transaction
-- (commuter/driver/system rows, and the frozen Legacy-bucket withdrawal
-- path) — only populated where creditRemittanceSplit()/quota crediting
-- can actually derive one.
ALTER TABLE wallet_transactions
  ADD COLUMN association_id INT NULL AFTER owner_id,
  ADD CONSTRAINT fk_wallet_transactions_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE SET NULL;

-- Which wallet a withdrawal was drawn from — NULL means the frozen Legacy
-- bucket (operators.wallet_balance), a real id means a specific
-- operator_association_wallets balance.
ALTER TABLE withdrawal_requests
  ADD COLUMN association_id INT NULL AFTER operator_id,
  ADD CONSTRAINT fk_withdrawal_requests_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE SET NULL;
