-- Adds an auditable verification trail for community correction reports.
-- The current static application stores this structure locally; a server
-- implementation can persist it with this migration.
ALTER TABLE correction_reports ADD COLUMN report_type TEXT;
ALTER TABLE correction_reports ADD COLUMN details_json TEXT;
ALTER TABLE correction_reports ADD COLUMN source_checks_json TEXT;
ALTER TABLE correction_reports ADD COLUMN proposed_change_json TEXT;
ALTER TABLE correction_reports ADD COLUMN requires_admin_review INTEGER NOT NULL DEFAULT 1;
ALTER TABLE correction_reports ADD COLUMN verified_at TEXT;

CREATE TABLE resource_verification_events (
  id INTEGER PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  correction_report_id INTEGER REFERENCES correction_reports(id),
  source_url TEXT,
  source_type TEXT,
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  facts_json TEXT,
  error_text TEXT
);

CREATE INDEX idx_correction_reports_status
  ON correction_reports(status, requires_admin_review);
CREATE INDEX idx_resource_verification_events_resource
  ON resource_verification_events(resource_id, checked_at);
