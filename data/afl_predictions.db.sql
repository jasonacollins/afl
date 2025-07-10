BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "app_config" (
	"key"	TEXT,
	"value"	TEXT NOT NULL,
	PRIMARY KEY("key")
);
CREATE TABLE IF NOT EXISTS "matches" (
	"match_id"	INTEGER,
	"match_number"	INTEGER NOT NULL,
	"round_number"	TEXT NOT NULL,
	"match_date"	TEXT,
	"venue"	TEXT,
	"home_team_id"	INTEGER,
	"away_team_id"	INTEGER,
	"hscore"	INTEGER,
	"hgoals"	INTEGER,
	"hbehinds"	INTEGER,
	"ascore"	INTEGER,
	"agoals"	INTEGER,
	"abehinds"	INTEGER,
	"year"	INTEGER,
	"complete"	INTEGER NOT NULL DEFAULT 0,
	"venue_id"	INTEGER,
	PRIMARY KEY("match_id"),
	FOREIGN KEY("away_team_id") REFERENCES "teams"("team_id"),
	FOREIGN KEY("home_team_id") REFERENCES "teams"("team_id"),
	FOREIGN KEY("venue_id") REFERENCES "venues"("venue_id")
);
CREATE TABLE IF NOT EXISTS "predictions" (
	"prediction_id"	INTEGER,
	"match_id"	INTEGER NOT NULL,
	"predictor_id"	INTEGER NOT NULL,
	"home_win_probability"	NUMERIC NOT NULL,
	"predicted_margin"	NUMERIC,
	"prediction_time"	TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	"tipped_team"	TEXT DEFAULT 'home',
	UNIQUE("match_id","predictor_id"),
	PRIMARY KEY("prediction_id"),
	FOREIGN KEY("match_id") REFERENCES "matches"("match_id"),
	FOREIGN KEY("predictor_id") REFERENCES "predictors"("predictor_id")
);
CREATE TABLE IF NOT EXISTS "predictors" (
	"predictor_id"	INTEGER,
	"name"	TEXT NOT NULL UNIQUE,
	"password"	TEXT NOT NULL,
	"is_admin"	INTEGER DEFAULT 0,
	"year_joined"	INTEGER,
	"display_name"	TEXT,
	"stats_excluded"	INTEGER DEFAULT 0,
	PRIMARY KEY("predictor_id")
);
CREATE TABLE IF NOT EXISTS "teams" (
	"team_id"	INTEGER,
	"name"	TEXT NOT NULL UNIQUE,
	"abbrev"	TEXT,
	"colour_hex"	TEXT,
	PRIMARY KEY("team_id")
);
CREATE TABLE IF NOT EXISTS "venue_aliases" (
	"alias_id"	INTEGER,
	"venue_id"	INTEGER NOT NULL,
	"alias_name"	TEXT NOT NULL,
	"start_date"	DATE,
	"end_date"	DATE,
	PRIMARY KEY("alias_id"),
	UNIQUE("venue_id","alias_name"),
	FOREIGN KEY("venue_id") REFERENCES "venues"("venue_id")
);
CREATE TABLE IF NOT EXISTS "venues" (
	"venue_id"	INTEGER,
	"name"	TEXT NOT NULL,
	"city"	TEXT NOT NULL,
	"state"	TEXT NOT NULL,
	PRIMARY KEY("venue_id")
);
CREATE INDEX IF NOT EXISTS "idx_venue_aliases_dates" ON "venue_aliases" (
	"start_date",
	"end_date"
);
CREATE INDEX IF NOT EXISTS "idx_venue_aliases_name" ON "venue_aliases" (
	"alias_name"
);
CREATE INDEX IF NOT EXISTS "idx_venues_state" ON "venues" (
	"state"
);
COMMIT;
