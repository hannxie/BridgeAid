-- Per-program eligibility source of truth and background research workflow.
-- The application database remains authoritative; CSV is an administrative export only.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  official_website TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  service_category TEXT NOT NULL,
  service_area_json TEXT NOT NULL,
  direct_application_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, name)
);

CREATE TABLE program_eligibility (
  program_id TEXT PRIMARY KEY REFERENCES programs(id),
  residency_requirements_json TEXT,
  age_requirements_json TEXT,
  income_limits_json TEXT,
  household_size_rules_json TEXT,
  housing_status_json TEXT,
  insurance_requirements_json TEXT,
  employment_student_status_json TEXT,
  disability_veteran_requirements_json TEXT,
  documentation_requirements_json TEXT,
  exceptions_json TEXT,
  application_deadline TEXT,
  eligibility_page_url TEXT,
  application_url TEXT,
  research_status TEXT NOT NULL DEFAULT 'pending',
  research_reason TEXT,
  last_verified_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE eligibility_research_queue (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  source_sequence_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  ambiguous_rules_json TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_programs_category_area ON programs(service_category, active);
CREATE INDEX idx_program_eligibility_status ON program_eligibility(research_status, last_verified_at);
CREATE INDEX idx_eligibility_research_queue ON eligibility_research_queue(status, priority DESC, next_attempt_at);
