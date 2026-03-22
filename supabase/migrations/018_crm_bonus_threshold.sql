-- ─── 018_crm_bonus_threshold.sql ────────────────────────────────────────────
-- Shift bonus threshold from 80 to 79 so that 80 orders already earns a bonus.
-- New logic: ≤79 → 0, 80–100 → (orders−79)×rate_mid, 101+ → (orders−79)×rate_high

ALTER TABLE crm_bonus_settings ALTER COLUMN threshold SET DEFAULT 79;
UPDATE crm_bonus_settings SET threshold = 79;
