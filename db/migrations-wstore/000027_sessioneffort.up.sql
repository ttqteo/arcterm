CREATE TABLE db_sessioneffort (
    harness TEXT NOT NULL,
    transcript TEXT NOT NULL,
    effortoid TEXT NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (harness, transcript)
);
