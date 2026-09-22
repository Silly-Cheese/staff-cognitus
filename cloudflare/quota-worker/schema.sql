CREATE TABLE IF NOT EXISTS quota_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  default_required_messages INTEGER NOT NULL DEFAULT 100,
  period_type TEXT NOT NULL DEFAULT 'weekly',
  anchor_date TEXT NOT NULL DEFAULT '2026-01-05',
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  staff_role_ids_json TEXT NOT NULL DEFAULT '[]',
  included_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  excluded_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL
);
INSERT OR IGNORE INTO quota_settings VALUES (
  1,100,'weekly','2026-01-05','America/Chicago','[]','[]','[]','2026-09-21T00:00:00Z','system'
);

CREATE TABLE IF NOT EXISTS quota_periods (
  id TEXT PRIMARY KEY,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  required_messages INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_roster (
  firebase_uid TEXT PRIMARY KEY,
  discord_user_id TEXT,
  display_name TEXT NOT NULL,
  employee_id TEXT,
  department_id TEXT,
  rank TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  custom_required_messages INTEGER,
  last_synced_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS quota_roster_discord
ON quota_roster(discord_user_id) WHERE discord_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_activity (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  activity_date TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT NOT NULL,
  PRIMARY KEY(guild_id,discord_user_id,activity_date,channel_id)
);
CREATE INDEX IF NOT EXISTS message_activity_user_date
ON message_activity(discord_user_id,activity_date);

CREATE TABLE IF NOT EXISTS quota_dedupe (
  message_id TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_exemptions (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quota_exemptions_user_dates
ON quota_exemptions(firebase_uid,starts_on,ends_on);

CREATE TABLE IF NOT EXISTS quota_adjustments (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  period_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quota_adjustments_user_period
ON quota_adjustments(firebase_uid,period_id);

CREATE TABLE IF NOT EXISTS quota_audit (
  id TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uid TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
