-- ─── 019_crm_bonus_threshold_fix.sql ────────────────────────────────────────
-- Revert threshold back to 80 (correct logic):
--   ≤80 orders → 0 грн
--   81–100      → (orders − 80) × rate_mid   e.g. 81 → 6 грн
--   101+        → (orders − 80) × rate_high  e.g. 101 → 168 грн

ALTER TABLE crm_bonus_settings ALTER COLUMN threshold SET DEFAULT 80;
UPDATE crm_bonus_settings SET threshold = 80;
