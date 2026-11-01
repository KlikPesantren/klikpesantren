const pool = require("../db");

exports.getMonitor = async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const { rows } = await pool.query(
      `
      SELECT
        d.id,
        d.device_id,
        d.nama_device,
        d.enabled,
        CASE WHEN d.last_ping IS NOT NULL AND d.last_ping >= NOW() - INTERVAL '60 seconds'
          THEN 'online' ELSE 'offline' END AS connection_state,
        CASE WHEN d.last_ping IS NOT NULL AND d.last_ping >= NOW() - INTERVAL '60 seconds'
          THEN 'online' ELSE 'offline' END AS status,
        d.last_ping,
        d.last_sync,
        m.nama_merchant,
        COUNT(tr.id) AS total_transaksi_hari_ini
      FROM devices d
      LEFT JOIN merchant_rfid m
        ON d.merchant_id = m.id AND m.tenant_id = d.tenant_id
      LEFT JOIN transaksi_rfid tr
        ON tr.device_id = d.id
       AND tr.tenant_id = d.tenant_id
       AND tr.created_at >= CURRENT_DATE
       AND tr.created_at < CURRENT_DATE + INTERVAL '1 day'
      WHERE d.tenant_id = $1
      GROUP BY d.id, m.nama_merchant
      ORDER BY d.device_id
      `,
      [tenantId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
};
