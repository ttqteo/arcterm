-- recovery copy of every channel blob as it was before the startup contract pass strips its arrays
CREATE TABLE IF NOT EXISTS db_channel_precontract AS SELECT oid, version, data FROM db_channel;
