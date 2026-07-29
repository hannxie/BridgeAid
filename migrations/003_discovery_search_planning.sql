-- Nationwide discovery, deterministic search diagnostics, and verification evidence.
-- Apply after 001_resource_foundation.sql and 002_correction_verification.sql.

ALTER TABLE resources ADD COLUMN scope TEXT NOT NULL DEFAULT 'location';
ALTER TABLE resources ADD COLUMN service_area_json TEXT;
ALTER TABLE resources ADD COLUMN verification_expires_at TEXT;
ALTER TABLE resources ADD COLUMN eligibility_status TEXT;
ALTER TABLE resources ADD COLUMN eligibility_evidence_json TEXT;
ALTER TABLE resources ADD COLUMN application_methods_json TEXT;
ALTER TABLE resources ADD COLUMN discovery_status TEXT NOT NULL DEFAULT 'verified';

CREATE TABLE coverage_gaps (
  id INTEGER PRIMARY KEY,
  location_key TEXT NOT NULL,
  location_label TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  category TEXT NOT NULL,
  verified_resource_count INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  discovery_status TEXT NOT NULL DEFAULT 'queued',
  last_searched_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(location_key, category)
);

CREATE TABLE search_runs (
  id TEXT PRIMARY KEY,
  normalized_signature TEXT NOT NULL,
  location_label TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  radius_miles REAL NOT NULL,
  category TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  sort_order TEXT NOT NULL,
  result_resource_ids_json TEXT NOT NULL,
  result_version TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE resource_eligibility_evidence (
  id INTEGER PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  source_url TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  extracted_rules_json TEXT,
  required_documents_json TEXT,
  service_area_json TEXT,
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  UNIQUE(resource_id, source_url, checked_at)
);

CREATE UNIQUE INDEX idx_resources_normalized_identity
  ON resources(organization_name, address, phone);
CREATE INDEX idx_resources_coordinates_category
  ON resources(latitude, longitude, category, verification_expires_at);
CREATE INDEX idx_coverage_gaps_priority
  ON coverage_gaps(discovery_status, priority DESC, updated_at);
CREATE INDEX idx_search_runs_signature
  ON search_runs(normalized_signature, completed_at);
CREATE INDEX idx_eligibility_evidence_resource
  ON resource_eligibility_evidence(resource_id, checked_at);
