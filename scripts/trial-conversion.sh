#!/bin/bash
# Trial conversion stats from prod DB

set -e

CONTAINER="appgrid-backend-prod-db-1"
PSQL="docker exec $CONTAINER psql -U appgrid_user -d appgrid_db"

ssh mikl@api.zekalogic.com "$PSQL -c \"
SELECT
  COUNT(*)                                                        AS total_trials,
  COUNT(*) FILTER (WHERE expires_at < NOW())                     AS expired,
  COUNT(*) FILTER (WHERE expires_at >= NOW())                    AS still_active,
  COUNT(*) FILTER (WHERE expires_at < NOW()
    AND da.device_fingerprint IN (
      SELECT da2.device_fingerprint
      FROM device_activations da2
      JOIN licenses l2 ON l2.id = da2.license_id
      WHERE l2.is_trial = false
    ))                                                           AS converted,
  ROUND(
    100.0 *
    COUNT(*) FILTER (WHERE expires_at < NOW()
      AND da.device_fingerprint IN (
        SELECT da2.device_fingerprint
        FROM device_activations da2
        JOIN licenses l2 ON l2.id = da2.license_id
        WHERE l2.is_trial = false
      )) /
    NULLIF(COUNT(*) FILTER (WHERE expires_at < NOW()), 0)
  , 1)                                                           AS conversion_pct
FROM licenses l
JOIN device_activations da ON da.license_id = l.id
WHERE l.is_trial = true;
\""
