-- the old blobs are gone for good; this copy of the contracted rows only keeps 000023's down runnable
CREATE TABLE IF NOT EXISTS db_channel_precontract AS SELECT oid, version, data FROM db_channel;
