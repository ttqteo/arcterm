CREATE TABLE IF NOT EXISTS db_xmastask (
    runid TEXT NOT NULL,
    taskid TEXT NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (runid, taskid)
);
CREATE INDEX IF NOT EXISTS idx_xmastask_ts ON db_xmastask(ts);
