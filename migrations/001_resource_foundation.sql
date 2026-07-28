-- Production foundation for a future server-side database.
-- This migration is not executed by the current static deployment.
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  organization_name TEXT NOT NULL,
  program_name TEXT,
  category TEXT NOT NULL,
  description TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  county TEXT,
  state TEXT,
  zip TEXT,
  latitude REAL,
  longitude REAL,
  website TEXT,
  official_website TEXT,
  registration_url TEXT,
  hours_json TEXT,
  schedule_rules_json TEXT,
  availability_status TEXT,
  eligibility_summary TEXT,
  eligibility_rules_json TEXT,
  required_documents_json TEXT,
  accessibility_json TEXT,
  languages_json TEXT,
  transportation_json TEXT,
  free_status TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unreviewed',
  last_verified TEXT,
  confidence REAL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE resource_sources (
  id INTEGER PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  source_url TEXT NOT NULL,
  source_type TEXT,
  discovered_at TEXT NOT NULL,
  verified_at TEXT,
  confidence REAL,
  extracted_facts_json TEXT,
  UNIQUE(resource_id, source_url)
);

CREATE TABLE resource_conflicts (
  id INTEGER PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  field_name TEXT NOT NULL,
  conflicting_values_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TEXT
);

CREATE TABLE correction_reports (
  id INTEGER PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  report_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  failures_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE admin_audit_log (
  id INTEGER PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  changes_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_resources_geo ON resources(state, city, zip);
CREATE INDEX idx_resources_review ON resources(review_status, verification_status);
CREATE INDEX idx_jobs_status ON background_jobs(status, next_attempt_at);
