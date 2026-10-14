const crypto = require("node:crypto");
const pool = require("../db");
const { isSantriAktif } = require("../utils/santriStatus");

async function syncOneTransaction(tenantId, device, trx) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`${tenantId}:${trx.trx_id}`],
    );

    const duplicate = await client.query(
      `SELECT tr.id, s.saldo, s.uid_rfid
       FROM transaksi_rfid tr
       LEFT JOIN santri s ON s.id = tr.santri_id AND s.tenant_id = tr.tenant_id
       WHERE tr.trx_id = $1 AND tr.tenant_id = $2`,
      [trx.trx_id, tenantId],
    );

    if (duplicate.rows.length > 0) {
      await client.query("COMMIT");
      return {
        trx_id: trx.trx_id,
        status: "duplicate",
        saldo_sekarang: Number(duplicate.rows[0].saldo || 0),
        snapshot: {
          uid_rfid: duplicate.rows[0].uid_rfid,
          saldo: Number(duplicate.rows[0].saldo || 0),
        },
      };
    }

    const santri = await client.query(
      `SELECT id, uid_rfid, saldo, status
       FROM santri
       WHERE uid_rfid = $1 AND tenant_id = $2
       FOR UPDATE`,
      [trx.uid_rfid, tenantId],
    );

    if (santri.rows.length === 0) {
      await client.query("ROLLBACK");
      return { trx_id: trx.trx_id, status: "santri_not_found" };
    }

    const s = santri.rows[0];
    if (!isSantriAktif(s.status)) {
      await client.query("ROLLBACK");
      return { trx_id: trx.trx_id, status: "credential_inactive" };
    }
    const nominal = Number(trx.nominal);
    if (!Number.isSafeInteger(nominal) || nominal <= 0) {
      await client.query("ROLLBACK");
      return { trx_id: trx.trx_id, status: "invalid_nominal" };
    }

    // OFFLINE: limit sengaja nonaktif. Semua transaksi queue yang valid disinkronkan.
    const saldoAwal = Number(s.saldo);
    const saldoAkhir = saldoAwal - nominal;

    await client.query(
      `UPDATE santri SET saldo = $1 WHERE id = $2 AND tenant_id = $3`,
      [saldoAkhir, s.id, tenantId],
    );
    await client.query(
      `INSERT INTO transaksi_rfid
       (trx_uuid, trx_id, santri_id, merchant_id, device_id, nominal,
        saldo_awal, saldo_akhir, sync_status, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'synced',$9)`,
      [
        crypto.randomUUID(), trx.trx_id, s.id, device.merchant_id, device.id,
        nominal, saldoAwal, saldoAkhir, tenantId,
      ],
    );
    await client.query(
      `INSERT INTO transaksi
       (santri_id, jenis, nominal, keterangan, trx_id, tenant_id)
       VALUES ($1, 'RFID', $2, 'Pembayaran RFID Sync', $3, $4)`,
      [s.id, nominal, trx.trx_id, tenantId],
    );
    await client.query("COMMIT");

    return {
      trx_id: trx.trx_id,
      status: "synced",
      saldo_sekarang: saldoAkhir,
      snapshot: { uid_rfid: s.uid_rfid, saldo: saldoAkhir },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

exports.syncTransactions = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const device = req.device;
    const { device_id, transactions } = req.body;

    if (!device || String(device.device_id) !== String(device_id)) {
      return res.status(401).json({ success: false, error: "Device tidak valid" });
    }

    const results = [];
    for (const trx of transactions || []) {
      try {
        results.push(await syncOneTransaction(tenantId, device, trx));
      } catch (err) {
        results.push({ trx_id: trx?.trx_id, status: "failed", error: err.message });
      }
    }

    await pool.query(
      `UPDATE devices SET last_sync = NOW()
       WHERE tenant_id = $1 AND device_id = $2`,
      [tenantId, device_id],
    );

    return res.json({
      success: results.every((item) => item.status !== "failed"),
      sync_status: "complete",
      results,
    });
  } catch (err) {
    console.error("[rfid.syncTransactions]", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.syncOneTransaction = syncOneTransaction;
