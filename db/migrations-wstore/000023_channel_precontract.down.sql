UPDATE db_channel SET data = (SELECT p.data FROM db_channel_precontract p WHERE p.oid = db_channel.oid)
WHERE oid IN (SELECT oid FROM db_channel_precontract);
DROP TABLE IF EXISTS db_channel_precontract;
