CREATE TABLE IF NOT EXISTS carrier_accounts (
  id         TEXT        PRIMARY KEY,
  tenant_id  TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  currency   CHAR(3)     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT carrier_accounts_named_once_per_tenant UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id                 TEXT        PRIMARY KEY,
  tenant_id          TEXT        NOT NULL,
  carrier_account_id TEXT        NOT NULL REFERENCES carrier_accounts (id),
  currency           CHAR(3)     NOT NULL,
  valid_from         TIMESTAMPTZ NOT NULL,
  valid_until        TIMESTAMPTZ,
  lanes              JSONB       NOT NULL,
  CONSTRAINT rate_cards_valid_period CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS rate_cards_by_carrier ON rate_cards (tenant_id, carrier_account_id);

CREATE TABLE IF NOT EXISTS invoices (
  id                 TEXT        PRIMARY KEY,
  tenant_id          TEXT        NOT NULL,
  carrier_account_id TEXT        NOT NULL REFERENCES carrier_accounts (id),
  number             TEXT        NOT NULL,
  currency           CHAR(3)     NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Carriers resend invoices. The same number from the same carrier is the same invoice.
  CONSTRAINT invoices_one_per_number UNIQUE (tenant_id, carrier_account_id, number)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                  TEXT   PRIMARY KEY,
  invoice_id          TEXT   NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  consignment_id      TEXT   NOT NULL,
  billed_minor        BIGINT NOT NULL,
  currency            CHAR(3) NOT NULL,
  billed_weight_grams INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS invoice_lines_by_consignment ON invoice_lines (consignment_id);

CREATE TABLE IF NOT EXISTS settlements (
  id                TEXT        PRIMARY KEY,
  tenant_id         TEXT        NOT NULL,
  line_id           TEXT        NOT NULL REFERENCES invoice_lines (id) ON DELETE CASCADE,
  invoice_id        TEXT        NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  state             TEXT        NOT NULL,
  variance_minor    BIGINT      NOT NULL DEFAULT 0,
  reasons           TEXT[]      NOT NULL DEFAULT '{}',
  auto_approved     BOOLEAN     NOT NULL DEFAULT FALSE,
  agreed_minor      BIGINT,
  note              TEXT,
  payment_reference TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlements_one_per_line UNIQUE (line_id)
);

CREATE INDEX IF NOT EXISTS settlements_open ON settlements (tenant_id, state)
  WHERE state NOT IN ('paid', 'written_off', 'rejected');

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
