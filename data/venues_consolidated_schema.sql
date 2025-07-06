-- Venue consolidation SQL script
-- This script creates the venues and venue_aliases tables with proper normalization

-- Create venues table
CREATE TABLE IF NOT EXISTS venues (
    venue_id INTEGER PRIMARY KEY,
    primary_name TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL
);

-- Create venue aliases table
CREATE TABLE IF NOT EXISTS venue_aliases (
    alias_id INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id INTEGER NOT NULL,
    alias_name TEXT NOT NULL,
    FOREIGN KEY (venue_id) REFERENCES venues(venue_id),
    UNIQUE(venue_id, alias_name)
);

-- Insert venues data
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (1, 'Marvel Stadium', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (2, 'GMHBA Stadium', 'Geelong', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (3, 'Optus Stadium', 'Perth', 'WA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (4, 'Accor Stadium', 'Sydney', 'NSW');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (5, 'Blundstone Arena', 'Hobart', 'TAS');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (6, 'University of Tasmania Stadium', 'Launceston', 'TAS');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (7, 'Metricon Stadium', 'Gold Coast', 'QLD');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (8, 'The Gabba', 'Brisbane', 'QLD');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (9, 'Sydney Cricket Ground', 'Sydney', 'NSW');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (10, 'Melbourne Cricket Ground', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (11, 'W.A.C.A. Ground', 'Perth', 'WA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (12, 'Jiangwan Stadium', 'Shanghai', 'INTL');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (13, 'Mars Stadium', 'Ballarat', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (14, 'Manuka Oval', 'Canberra', 'ACT');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (15, 'TIO Stadium', 'Darwin', 'NT');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (16, 'Princes Park', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (17, 'Victoria Park', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (18, 'Junction Oval', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (19, 'Waverley Park', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (20, 'Lake Oval', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (21, 'Western Oval', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (22, 'Windy Hill', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (23, 'Brunswick St', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (24, 'Subiaco', 'Perth', 'WA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (25, 'Punt Rd', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (26, 'Arden St', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (27, 'Football Park', 'Adelaide', 'SA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (28, 'Glenferrie Oval', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (29, 'Corio Oval', 'Geelong', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (30, 'Adelaide Oval', 'Adelaide', 'SA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (31, 'Moorabbin Oval', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (32, 'East Melbourne', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (33, 'Sydney Showground', 'Sydney', 'NSW');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (34, 'Cazaly''s Stadium', 'Cairns', 'QLD');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (35, 'Toorak Park', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (36, 'Traeger Park', 'Alice Springs', 'NT');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (37, 'Coburg Oval', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (38, 'Yarraville Oval', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (39, 'Norwood Oval', 'Adelaide', 'SA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (40, 'North Hobart', 'Hobart', 'TAS');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (41, 'Wellington', 'Wellington', 'NZ');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (42, 'Olympic Park', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (43, 'Adelaide Hills', 'Adelaide', 'SA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (44, 'Barossa Park', 'Adelaide', 'SA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (45, 'Yallourn', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (46, 'Riverway Stadium', 'Townsville', 'QLD');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (47, 'Hands Oval', 'Bunbury', 'WA');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (48, 'Euroa', 'Melbourne', 'VIC');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (49, 'Bruce Stadium', 'Canberra', 'ACT');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (50, 'Brisbane Exhibition', 'Brisbane', 'QLD');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (51, 'Blacktown', 'Sydney', 'NSW');
INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES (52, 'Albury', 'Albury', 'NSW');

-- Insert venue aliases
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (1, 'Docklands'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (2, 'Kardinia Park'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (3, 'Perth Stadium'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (4, 'Stadium Australia'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (5, 'Bellerive Oval'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (6, 'York Park'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (7, 'Carrara'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (8, 'Gabba'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (9, 'S.C.G.'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (10, 'M.C.G.'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (11, 'W.A.C.A.'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (12, 'Adelaide Arena at Jiangwan Stadium'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (13, 'Eureka Stadium'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (14, 'UNSW Canberra Oval'');
INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES (15, 'Marrara Oval'');

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_venues_state ON venues(state);
CREATE INDEX IF NOT EXISTS idx_venue_aliases_name ON venue_aliases(alias_name);

-- Add venue_id column to matches table (run this after creating venues)
-- ALTER TABLE matches ADD COLUMN venue_id INTEGER REFERENCES venues(venue_id);

-- Update matches with venue_id (you'll need to run this after the above)
-- UPDATE matches SET venue_id = (
--     SELECT COALESCE(
--         (SELECT venue_id FROM venues WHERE primary_name = matches.venue),
--         (SELECT venue_id FROM venue_aliases WHERE alias_name = matches.venue)
--     )
-- );
