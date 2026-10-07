CREATE INDEX IF NOT EXISTS idx_channelmessage_reforef ON db_channelmessage (json_extract(data, '$.reforef'));
