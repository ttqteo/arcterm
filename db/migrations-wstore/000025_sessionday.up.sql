CREATE TABLE IF NOT EXISTS db_sessionday (
    day TEXT NOT NULL,
    harness TEXT NOT NULL,
    session TEXT NOT NULL,
    cwd TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    PRIMARY KEY (day, harness, session)
);
CREATE INDEX IF NOT EXISTS idx_sessionday_cwd ON db_sessionday(cwd, day);
