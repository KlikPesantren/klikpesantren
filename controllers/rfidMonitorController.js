const pool = require("../db");

exports.getMonitor = async (req, res) => {
  try {
    const tenantId = req.tenantId;

    await pool.query(`
      UPDATE devices
      SET status = 'offline', connection_state = 'offline'
      WHERE tenant_id = $1
        AND last_ping IS NOT NULL
        AND last_ping < NOW() - INTERVAL '60 seconds'
    `, [tenantId]);

    await pool.query(`
      UPDATE devices
      SET status = 'online', connection_state = 'online'
      WHERE tenant_id = $1
        AND last_ping IS NOT NULL
        AND last_ping >= NOW() - INTERVAL '60 seconds'
    `, [tenantId]);

    const { rows } = await pool.query(
      `
      SELECT
        d.id,
        d.device_id,
        d.nama_device,
        d.enabled,
        d.connection_state,
        d.status,
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
       AND DATE(tr.created_at) = CURRENT_DATE
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
