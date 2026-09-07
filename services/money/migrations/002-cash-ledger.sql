CREATE TABLE IF NOT EXISTS cash_movements (
  movement_key TEXT        PRIMARY KEY,
  tenant_id    TEXT        NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_entries (
  id           TEXT        PRIMARY KEY,
  movement_key TEXT        NOT NULL REFERENCES cash_movements (movement_key),
  tenant_id    TEXT        NOT NULL,
  kind         TEXT        NOT NULL,
  account      TEXT        NOT NULL,
  driver_id    TEXT,
  merchant_id  TEXT,
  delta_minor  BIGINT      NOT NULL,
  amount_minor BIGINT      NOT NULL,
  currency     TEXT        NOT NULL,
  reference    TEXT        NOT NULL,
  approved_by  TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL,
  CONSTRAINT cash_entries_account CHECK (account IN ('driver_float', 'merchant_payable')),
  CONSTRAINT cash_entries_amount_is_positive CHECK (amount_minor > 0),
  CONSTRAINT cash_entries_delta_is_not_zero CHECK (delta_minor <> 0),
  CONSTRAINT cash_entries_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT cash_entries_driver_float_names_a_driver
    CHECK (account <> 'driver_float' OR driver_id IS NOT NULL),
  CONSTRAINT cash_entries_merchant_payable_names_a_merchant
    CHECK (account <> 'merchant_payable' OR merchant_id IS NOT NULL),
  CONSTRAINT cash_entries_write_off_is_approved
    CHECK (kind <> 'written_off' OR approved_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS cash_entries_by_driver
  ON cash_entries (tenant_id, driver_id, currency) WHERE account = 'driver_float';
CREATE INDEX IF NOT EXISTS cash_entries_by_merchant
  ON cash_entries (tenant_id, merchant_id, currency) WHERE account = 'merchant_payable';
