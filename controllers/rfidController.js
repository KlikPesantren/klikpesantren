const pool = require("../db");
const auditService = require("../services/auditService");
const {
  parsePagination,
  buildPaginationResponse,
} = require("../utils/paginationHelpers");
const { isSantriAktif } = require("../utils/santriStatus");
const {
  getWalletAccountForSantri,
  getOrCreateWalletAccountForSantri,
  resolveWalletAccess,
  sendUnitError,
} = require("../services/walletUnitService");

const crypto = require("crypto");

const XLSX = require("xlsx");
// ==========================
// RFID PAYMENT
// ==========================

exports.lookupCard = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { uid_rfid } = req.body || {};

    if (!uid_rfid) {
      return res.status(400).json({
        success: false,
        error: "uid_rfid wajib",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT id, nama, uid_rfid, saldo, limit_harian, status, kamar
      FROM santri
      WHERE uid_rfid = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      [uid_rfid, tenantId]
    );

    if (rows.length === 0) {
      return res.json({
        success: false,
        error: "Santri tidak ditemukan",
      });
    }

    const santri = rows[0];
    if (!isSantriAktif(santri.status)) {
      return res.status(409).json({
        success: false,
        error: "Santri nonaktif",
      });
    }

    const usageResult = await pool.query(
      `
      SELECT COALESCE(SUM(nominal), 0) total
      FROM transaksi_rfid
      WHERE santri_id = $1
        AND tenant_id = $2
        AND DATE(created_at) = CURRENT_DATE
        AND LOWER(TRIM(COALESCE(trx_type, 'payment'))) = 'payment'
      `,
      [santri.id, tenantId]
    );

    const pemakaianHariIni = Number(usageResult.rows[0]?.total || 0);
    const limitHarian = santri.limit_harian === null
      ? null
      : Number(santri.limit_harian || 0);
    const sisaLimitHariIni = limitHarian === null
      ? null
      : Math.max(limitHarian - pemakaianHariIni, 0);

    res.json({
      success: true,
      data: {
        uid_rfid: santri.uid_rfid,
        nama: santri.nama,
        saldo: Number(santri.saldo || 0),
        limit_harian: limitHarian,
        pemakaian_hari_ini: pemakaianHariIni,
        sisa_limit_hari_ini: sisaLimitHariIni,
      },
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.rfidPayment = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      uid_rfid,
      nominal,
      device_id,
      trx_id,
      override_limit = false,
      offline_sync = false
    } = req.body;
    const isOfflineSync = offline_sync === true;

    if (!trx_id || !Number.isSafeInteger(Number(nominal)) || Number(nominal) <= 0) {
      return res.status(400).json({ success: false, error: "Data transaksi tidak valid" });
    }

    const santriResult = await pool.query(
      `
      SELECT *
      FROM santri
      WHERE uid_rfid = $1
        AND tenant_id = $2
      `,
      [uid_rfid, tenantId]
    );

    if (santriResult.rows.length === 0) {
      return res.json({
        success: false,
        error: "Kartu tidak terdaftar"
      });
    }

    const santri = santriResult.rows[0];

    if (!isSantriAktif(santri.status)) {
      return res.status(409).json({
        success: false,
        error: "Santri nonaktif tidak dapat melakukan pembayaran RFID",
      });
    }

    const duplicate = await pool.query(
      `
      SELECT id
      FROM transaksi_rfid
      WHERE trx_id = $1
        AND tenant_id = $2
      `,
      [trx_id, tenantId]
    );

    if (duplicate.rows.length > 0) {
      return res.json({
        success: true,
        message: "Duplicate ignored",
        saldo_sekarang: Number(santri.saldo),
        sync_status: "duplicate",
        snapshot: { uid_rfid: santri.uid_rfid, saldo: Number(santri.saldo) }
      });
    }

    const device = req.device;
    if (!device || String(device.device_id) !== String(device_id)) {
      return res.json({
        success: false,
        error: "Device tidak terdaftar"
      });
    }
   // ==========================
    // SALDO
    // ==========================

    // ==========================
    // ONLINE: limit aktif dan diperiksa ulang setelah row lock.
    // OFFLINE sync: limit nonaktif sesuai keputusan produk.
    // ==========================

    const limit =
      santri.limit_harian === null
        ? null
        : Number(santri.limit_harian || 0);

 
    // ==========================
    // TRANSACTION
    // ==========================

    const client =
      await pool.connect();

    try {

      await client.query("BEGIN");

      // Satu transaction_id hanya boleh diproses satu kali, termasuk retry paralel.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`${tenantId}:${trx_id}`]
      );

      const duplicateLocked = await client.query(
        `SELECT id FROM transaksi_rfid WHERE trx_id = $1 AND tenant_id = $2`,
        [trx_id, tenantId]
      );

      if (duplicateLocked.rows.length > 0) {
        const current = await client.query(
          `SELECT saldo FROM santri WHERE id = $1 AND tenant_id = $2`,
          [santri.id, tenantId]
        );
        const currentSaldo = Number(current.rows[0]?.saldo || 0);
        await client.query("COMMIT");
        return res.json({
          success: true,
          message: "Duplicate ignored",
          saldo_sekarang: currentSaldo,
          sync_status: "duplicate",
          snapshot: { uid_rfid, saldo: currentSaldo },
        });
      }

      // Revalidate the credential while holding the santri row lock. Clearing or
      // replacing a lost card in Admin must win before a payment can commit.
      const lockedSantriResult = await client.query(
        `SELECT saldo, status
         FROM santri
         WHERE id = $1 AND tenant_id = $2 AND uid_rfid = $3
         FOR UPDATE`,
        [santri.id, tenantId, uid_rfid]
      );
      if (!lockedSantriResult.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "Kartu tidak aktif" });
      }
      if (!isSantriAktif(lockedSantriResult.rows[0].status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          error: "Santri nonaktif tidak dapat melakukan pembayaran RFID",
        });
      }
      const lockedSaldoAwal = Number(lockedSantriResult.rows[0].saldo);

      // ONLINE: saldo dan limit wajib aktif. OFFLINE sync: limit sengaja nonaktif.
      if (!isOfflineSync && lockedSaldoAwal < Number(nominal)) {
        await client.query("ROLLBACK");
        return res.json({ success: false, error: "Saldo tidak cukup" });
      }

      if (!isOfflineSync && limit !== null) {
        const lockedUsage = await client.query(
          `SELECT COALESCE(SUM(nominal), 0) total
           FROM transaksi_rfid
           WHERE santri_id = $1 AND tenant_id = $2
             AND DATE(created_at) = CURRENT_DATE
             AND LOWER(TRIM(COALESCE(trx_type, 'payment'))) = 'payment'`,
          [santri.id, tenantId]
        );
        if (Number(lockedUsage.rows[0].total) + Number(nominal) > limit) {
          await client.query("ROLLBACK");
          return res.json({ success: false, error: "Limit harian habis" });
        }
      }

      const lockedSaldoAkhir = lockedSaldoAwal - Number(nominal);

      await client.query(
        `
        UPDATE santri
        SET saldo = $1
        WHERE id = $2
          AND tenant_id = $3
        `,
        [
          lockedSaldoAkhir,
          santri.id,
          tenantId
        ]
      );

      const trxUuid =
        crypto.randomUUID();

      await client.query(
        `
        INSERT INTO transaksi_rfid
        (
          trx_uuid,
          trx_id,
          santri_id,
          merchant_id,
          device_id,
          nominal,
          saldo_awal,
          saldo_akhir,
          is_override,
          sync_status,
          tenant_id
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,'synced',$10
        )
        `,
        [
          trxUuid,
          trx_id,
          santri.id,
          device.merchant_id,
          device.id,
          nominal,
          lockedSaldoAwal,
          lockedSaldoAkhir,
          override_limit,
          tenantId
        ]
      );

      await client.query(
        `
        INSERT INTO transaksi
        (
          santri_id,
          jenis,
          nominal,
          keterangan,
          trx_id,
          tenant_id
        )
        VALUES
        (
          $1,
          'RFID',
          $2,
          'Pembayaran RFID',
          $3,
          $4
        )
        `,
        [
          santri.id,
          nominal,
          trx_id,
          tenantId
        ]
      );

      await client.query("COMMIT");

       // await auditService(
       // null,
       // "RFID_PAYMENT",
      // `${santri.nama} | Rp ${nominal}`
     //);

      return res.json({
        success: true,
        saldo_sekarang: lockedSaldoAkhir,
        sync_status: isOfflineSync ? "synced" : "online",
        snapshot: { uid_rfid, saldo: lockedSaldoAkhir }
      });

    } catch (err) {

      await client.query(
        "ROLLBACK"
      );

      throw err;

    } finally {

      client.release();

    }

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  }
};

// ==========================
// DASHBOARD RFID
// ==========================
exports.getDashboard =
async (req,res)=>{

  try{
    const tenantId = req.tenantId;
    const access = await resolveWalletAccess(req);
    const unitFilter = access.mode === "UNIT" ? " AND unit_id = $2" : "";
    const unitParams = access.mode === "UNIT" ? [tenantId, access.unitId] : [tenantId];
    const walletTxUnitFilter = access.mode === "UNIT" ? " AND wt.unit_id = $2" : "";
    const walletTxParams = unitParams;

    const totalSaldo =
      await pool.query(`
        SELECT COALESCE(SUM(current_balance), 0) total
        FROM wallet_accounts
        WHERE tenant_id = $1${unitFilter}
      `, unitParams);

    const totalMerchant =
      await pool.query(`
        SELECT COUNT(*)
        FROM merchant_rfid
        WHERE status=true AND tenant_id = $1${unitFilter}
      `, unitParams);

    const totalDevice =
      await pool.query(`
        SELECT COUNT(*)
        FROM devices
        WHERE tenant_id = $1${unitFilter}
      `, unitParams);

    const online =
      await pool.query(`
        SELECT COUNT(*)
        FROM devices
        WHERE status='online' AND tenant_id = $1${unitFilter}
      `, unitParams);

    const offline =
      await pool.query(`
        SELECT COUNT(*)
        FROM devices
        WHERE status!='online' AND tenant_id = $1${unitFilter}
      `, unitParams);

    const transaksiHariIni =
      await pool.query(`
        SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0) total
        FROM wallet_transactions wt
        WHERE DATE(created_at) = CURRENT_DATE
          AND tenant_id = $1${walletTxUnitFilter}
      `, walletTxParams);

    const pending =
      access.mode === "UNIT"
        ? { rows: [{ count: 0 }] }
        : await pool.query(`
          SELECT COUNT(*)
          FROM rfid_sync_queue
          WHERE sync_status='pending' AND tenant_id = $1
        `, [tenantId]);

    const failed =
      access.mode === "UNIT"
        ? { rows: [{ count: 0 }] }
        : await pool.query(`
          SELECT COUNT(*)
          FROM rfid_sync_queue
          WHERE sync_status='failed' AND tenant_id = $1
        `, [tenantId]);

    const kartuAktif =
      await pool.query(`
        SELECT COUNT(*)
        FROM wallet_accounts wa
        JOIN santri s
          ON s.id = wa.santri_id
         AND s.tenant_id = wa.tenant_id
        WHERE s.uid_rfid IS NOT NULL
          AND wa.tenant_id = $1${access.mode === "UNIT" ? " AND wa.unit_id = $2" : ""}
      `, unitParams);

    res.json({

      total_saldo:
        totalSaldo.rows[0].total,

      belanja_hari_ini:
        transaksiHariIni.rows[0].total,

      merchant_aktif:
        totalMerchant.rows[0].count,

      total_device:
        totalDevice.rows[0].count,

      device_online:
        online.rows[0].count,

      device_offline:
        offline.rows[0].count,

      pending_sync:
        pending.rows[0].count,

      failed_sync:
        failed.rows[0].count,

      kartu_aktif:
        kartuAktif.rows[0].count,

      access: {
        all_units: access.mode === "ALL",
        unit_id: access.mode === "UNIT" ? access.unitId : null
      }

    });

  }

  catch(err){

    console.log(err);

    sendUnitError(res, err, "Dashboard dompet gagal dimuat");

  }

};

exports.getDashboardSummary =
async(req,res)=>{

  try{
    const tenantId = req.tenantId;
    const access = await resolveWalletAccess(req);
    const unitFilter = access.mode === "UNIT" ? " AND wt.unit_id = $2" : "";
    const unitParams = access.mode === "UNIT" ? [tenantId, access.unitId] : [tenantId];
    const deviceUnitFilter = access.mode === "UNIT" ? " AND unit_id = $2" : "";

    const stats = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE DATE(wt.created_at) = CURRENT_DATE
          )::int AS transaksi_hari_ini,
          COALESCE(SUM(wt.amount) FILTER (
            WHERE DATE(wt.created_at) = CURRENT_DATE
              AND wt.direction = 'debit'
          ), 0)::bigint AS nominal_hari_ini,
          COUNT(*) FILTER (
            WHERE DATE(wt.created_at) = CURRENT_DATE
              AND LOWER(TRIM(wt.type)) = 'topup'
          )::int AS topup_hari_ini,
          COUNT(*) FILTER (
            WHERE DATE(wt.created_at) = CURRENT_DATE
              AND LOWER(TRIM(wt.type)) = 'refund'
          )::int AS refund_hari_ini
        FROM wallet_transactions wt
        WHERE wt.tenant_id = $1${unitFilter}
      `,
      unitParams,
    );

    const devices = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'online')::int AS device_online,
          COUNT(*) FILTER (WHERE status != 'online')::int AS device_offline
        FROM devices
        WHERE tenant_id = $1${deviceUnitFilter}
      `,
      unitParams,
    );

    const pending = access.mode === "UNIT"
      ? { rows: [{ pending_sync: 0 }] }
      : await pool.query(`
        SELECT COUNT(*)::int AS pending_sync
        FROM rfid_sync_queue
        WHERE sync_status = 'pending'
          AND tenant_id = $1
      `, [tenantId]);

    const topMerchant = await pool.query(
      `
        SELECT
          COALESCE(m.nama_merchant, 'Merchant') AS name,
          COUNT(*)::int AS count
        FROM wallet_transactions wt
        LEFT JOIN merchant_rfid m
          ON m.id = wt.merchant_id
         AND m.tenant_id = wt.tenant_id
        WHERE wt.tenant_id = $1
          AND wt.direction = 'debit'
          AND wt.created_at >= (CURRENT_DATE - INTERVAL '30 days')${unitFilter}
        GROUP BY COALESCE(m.nama_merchant, 'Merchant')
        ORDER BY count DESC
        LIMIT 1
      `,
      unitParams,
    );

    const recent = await pool.query(
      `
        SELECT
          wt.id,
          wt.created_at,
          wt.amount AS nominal,
          wt.type AS trx_type,
          s.nama AS nama_santri,
          s.kamar,
          m.nama_merchant
        FROM wallet_transactions wt
        LEFT JOIN santri s
          ON s.id = wt.santri_id
         AND s.tenant_id = wt.tenant_id
        LEFT JOIN merchant_rfid m
          ON m.id = wt.merchant_id
         AND m.tenant_id = wt.tenant_id
        WHERE wt.tenant_id = $1${unitFilter}
        ORDER BY wt.created_at DESC
        LIMIT 5
      `,
      unitParams,
    );

    const row = stats.rows[0] || {};
    const deviceRow = devices.rows[0] || {};
    const pendingRow = pending.rows[0] || {};

    res.json({
      success: true,
      data: {
        transaksi_hari_ini: row.transaksi_hari_ini || 0,
        nominal_hari_ini: Number(row.nominal_hari_ini || 0),
        topup_hari_ini: row.topup_hari_ini || 0,
        refund_hari_ini: row.refund_hari_ini || 0,
        device_online: deviceRow.device_online || 0,
        device_offline: deviceRow.device_offline || 0,
        pending_sync: pendingRow.pending_sync || 0,
        top_merchant: topMerchant.rows[0] || null,
        recent_activity: recent.rows,
        access: {
          all_units: access.mode === "ALL",
          unit_id: access.mode === "UNIT" ? access.unitId : null,
        },
      },
    });

  }

  catch(err){

    console.log(err);

    sendUnitError(res, err, "Dashboard dompet gagal dimuat");

  }

};

// ==========================
// RFID TRANSACTIONS
// ==========================

function buildTransactionFilters(tenantId, query, access, { applyDefaultDateRange = false } = {}) {
  const conditions = ["wt.tenant_id = $1"];
  const params = [tenantId];
  let index = 2;

  if (access?.mode === "UNIT") {
    conditions.push(`wt.unit_id = $${index}`);
    params.push(access.unitId);
    index += 1;
  }

  const hasDateFilter = query.start_date || query.end_date;

  if (query.start_date) {
    conditions.push(`wt.created_at >= $${index}::date`);
    params.push(String(query.start_date));
    index += 1;
  } else if (applyDefaultDateRange && !hasDateFilter) {
    conditions.push(`wt.created_at >= (CURRENT_DATE - INTERVAL '6 days')`);
  }

  if (query.end_date) {
    conditions.push(`wt.created_at < ($${index}::date + INTERVAL '1 day')`);
    params.push(String(query.end_date));
    index += 1;
  } else if (applyDefaultDateRange && !hasDateFilter) {
    conditions.push(`wt.created_at < (CURRENT_DATE + INTERVAL '1 day')`);
  }

  if (query.santri_id) {
    conditions.push(`wt.santri_id = $${index}`);
    params.push(Number(query.santri_id));
    index += 1;
  }

  if (query.merchant_id) {
    conditions.push(`wt.merchant_id = $${index}`);
    params.push(Number(query.merchant_id));
    index += 1;
  }

  if (query.device_id) {
    conditions.push(`wt.device_id = $${index}`);
    params.push(Number(query.device_id));
    index += 1;
  }

  if (query.type) {
    conditions.push(`LOWER(TRIM(wt.type)) = LOWER(TRIM($${index}))`);
    params.push(String(query.type));
    index += 1;
  }

  if (query.search && String(query.search).trim()) {
    const pattern = `%${String(query.search).trim()}%`;
    conditions.push(`(s.nama ILIKE $${index} OR s.nis ILIKE $${index})`);
    params.push(pattern);
    index += 1;
  }

  return {
    whereSql: conditions.join(" AND "),
    params,
    nextIndex: index,
    joinSql: `
      FROM wallet_transactions wt
      JOIN wallet_accounts wa
        ON wa.id = wt.wallet_account_id
       AND wa.tenant_id = wt.tenant_id
       AND wa.unit_id = wt.unit_id
      LEFT JOIN santri s
        ON s.id = wt.santri_id AND s.tenant_id = wt.tenant_id
      LEFT JOIN merchant_rfid m
        ON m.id = wt.merchant_id AND m.tenant_id = wt.tenant_id
      LEFT JOIN devices d
        ON d.id = wt.device_id AND d.tenant_id = wt.tenant_id
      LEFT JOIN transaksi tx
        ON tx.trx_id = wt.reference_id AND tx.tenant_id = wt.tenant_id
      LEFT JOIN users u
        ON u.id = tx.created_by AND u.tenant_id = wt.tenant_id
    `,
  };
}

exports.getTransactions =
async(req,res)=>{

  try{
    const tenantId = req.tenantId;
    const access = await resolveWalletAccess(req);
    const paging = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const { whereSql, params, nextIndex, joinSql } = buildTransactionFilters(
      tenantId,
      req.query,
      access,
      { applyDefaultDateRange: paging.hasPagingParams },
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total ${joinSql} WHERE ${whereSql}`,
      params,
    );

    const total = countResult.rows[0]?.total || 0;

    let listSql = `
      SELECT
        wt.id,
        wt.created_at,
        wt.wallet_account_id,
        wt.tenant_id,
        wt.unit_id,
        wt.santri_id,
        wt.type,
        wt.type AS trx_type,
        wt.direction,
        wt.amount,
        wt.amount AS nominal,
        NULL::bigint AS saldo_awal,
        wt.balance_after,
        wt.balance_after AS saldo_akhir,
         wt.reference_id AS trx_id,
         wt.source,
         wt.reference_type,
         CASE WHEN
           LOWER(TRIM(wt.type)) = 'topup'
           AND LOWER(TRIM(wt.direction)) = 'credit'
           AND LOWER(TRIM(wt.source)) = 'admin'
           AND LOWER(TRIM(COALESCE(wt.reference_type, ''))) = 'manual_topup'
           AND wt.reference_id IS NOT NULL
           AND wt.merchant_id IS NULL
           AND wt.device_id IS NULL
           AND tx.id IS NOT NULL
           AND tx.santri_id = wt.santri_id
           AND tx.nominal = wt.amount
           AND UPPER(TRIM(COALESCE(tx.jenis, ''))) = 'TOPUP RFID'
           AND NOT EXISTS (
             SELECT 1 FROM transaksi_rfid linked_rfid
             WHERE linked_rfid.tenant_id = wt.tenant_id
               AND (
                 linked_rfid.trx_id = wt.reference_id
                 OR linked_rfid.trx_id = 'REFUND-OF-' || wt.reference_id
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM wallet_transactions child
             WHERE child.tenant_id = wt.tenant_id
               AND child.id <> wt.id
               AND (
                 child.reference_id = wt.id::text
                 OR child.reference_id = wt.idempotency_key
                 OR (
                   child.reference_id = wt.reference_id
                   AND NOT (
                     LOWER(TRIM(child.type)) = 'topup'
                     AND LOWER(TRIM(child.source)) = 'admin'
                     AND LOWER(TRIM(COALESCE(child.reference_type, ''))) = 'manual_topup'
                   )
                 )
               )
           )
         THEN TRUE ELSE FALSE END AS correction_eligible,
         wt.merchant_id,
        wt.device_id,
        'synced'::text AS sync_status,
        s.nama AS nama_santri,
        s.kamar,
        s.nis,
        m.nama_merchant,
        d.device_id,
        u.nama AS nama_petugas
      ${joinSql}
      WHERE ${whereSql}
      ORDER BY wt.created_at DESC
    `;

    const listParams = [...params];

    if (paging.hasPagingParams) {
      listSql += ` LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`;
      listParams.push(paging.limit, paging.offset);
    }

    const result = await pool.query(listSql, listParams);

    res.json({
      success:true,
      data: result.rows,
      access: {
        all_units: access.mode === "ALL",
        unit_id: access.mode === "UNIT" ? access.unitId : null,
      },
      pagination: buildPaginationResponse({
        hasPagingParams: paging.hasPagingParams,
        limit: paging.limit,
        offset: paging.offset,
        total,
        rowCount: result.rows.length,
      }),
    });

  }

  catch(err){

    console.log(err);

    sendUnitError(res, err, "Transaksi dompet gagal dimuat");

  }

};

exports.searchSantri =
async(req,res)=>{

  try{
    const tenantId = req.tenantId;
    const access = await resolveWalletAccess(req, pool, { requireSpecific: true });
    const search = String(req.query.search || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    if (!search) {
      return res.json({ success: true, data: [] });
    }

    const pattern = `%${search}%`;

    const result = await pool.query(
      `
        SELECT
          s.id,
          s.nis,
          s.nama,
          s.uid_rfid,
          COALESCE(wa.current_balance, 0) AS saldo,
          s.status,
          enrollment.kelas_id,
          k.nama_kelas,
          su.unit_id,
          wa.id AS wallet_account_id
        FROM santri_units su
        JOIN santri s
          ON s.id = su.santri_id
         AND s.tenant_id = su.tenant_id
        LEFT JOIN LATERAL (
          SELECT ske.kelas_id
          FROM santri_kelas_enrollments ske
          WHERE ske.tenant_id = su.tenant_id
            AND ske.santri_unit_id = su.id
            AND ske.status = 'active' AND ske.end_date IS NULL
          ORDER BY ske.id DESC LIMIT 1
        ) enrollment ON TRUE
        LEFT JOIN kelas k
          ON k.id = enrollment.kelas_id
         AND k.tenant_id = su.tenant_id
         AND k.unit_id = su.unit_id
        LEFT JOIN wallet_accounts wa
          ON wa.tenant_id = su.tenant_id
         AND wa.unit_id = su.unit_id
         AND wa.santri_id = su.santri_id
        WHERE su.tenant_id = $1
          AND su.unit_id = $2
          AND su.status = 'active'
          AND su.left_at IS NULL
          AND (
            s.nama ILIKE $3
            OR s.nis ILIKE $3
            OR s.uid_rfid ILIKE $3
          )
        ORDER BY s.nama ASC
        LIMIT $4
      `,
      [tenantId, access.unitId, pattern, limit],
    );

    res.json({
      success: true,
      data: result.rows,
    });

  }

  catch(err){

    console.log(err);

    sendUnitError(res, err, "Pencarian santri dompet gagal");

  }

};

// ==========================
// RFID TOPUP
// ==========================

exports.topupSaldo =
async(req,res)=>{

  const client =
    await pool.connect();

  const tenantId = req.tenantId;

  try{

    const {
      santri_id,
      nominal,
      user_id
    } = req.body;
    const amount = Number(nominal);
    if (!Number.isInteger(Number(santri_id)) || Number(santri_id) <= 0) {
      return res.status(400).json({ success: false, error: "Santri wajib dipilih" });
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: "Nominal topup tidak valid" });
    }

    await client.query(
      "BEGIN"
    );

    const access = await resolveWalletAccess(req, client, { requireSpecific: true });
    const walletAccount = await getOrCreateWalletAccountForSantri(client, {
      tenantId,
      unitId: access.unitId,
      santriId: Number(santri_id),
    });

    if(!walletAccount){
      throw new Error(
        "Santri tidak ditemukan"
      );
    }

    if (!isSantriAktif(walletAccount.santri_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        error: "Santri nonaktif tidak dapat melakukan topup RFID",
      });
    }

    const saldoAwal =
      Number(
        walletAccount.current_balance
      );

    const saldoAkhir =
      saldoAwal +
      amount;

        const trxId =
      `TOPUP-${Date.now()}`;

    await client.query(
      `
      UPDATE wallet_accounts
      SET current_balance=$1,
          updated_at=NOW()
      WHERE id=$2
        AND tenant_id=$3
        AND unit_id=$4
      `,
      [
        saldoAkhir,
        walletAccount.id,
        tenantId,
        access.unitId
      ]
    );

    await client.query(
      `INSERT INTO wallet_transactions (
         wallet_account_id, tenant_id, unit_id, santri_id, type, direction,
         amount, balance_after, reference_type, reference_id, source,
         actor_user_id, location_unit_id, idempotency_key
       )
       VALUES ($1, $2, $3, $4, 'topup', 'credit', $5, $6, 'manual_topup', $7, 'admin', $8, $3, $9)`,
      [
        walletAccount.id,
        tenantId,
        access.unitId,
        Number(santri_id),
        amount,
        saldoAkhir,
        trxId,
        req.user?.id || user_id || null,
        `${tenantId}:${access.unitId}:${trxId}`,
      ]
    );

     await client.query(
      `
      INSERT INTO transaksi
      (
        santri_id,
        jenis,
        nominal,
        keterangan,
        created_by,
        trx_id,
        tenant_id
      )
      VALUES
      (
        $1,
        'TOPUP RFID',
        $2,
        'Topup Saldo RFID',
        $3,
        $4,
        $5
      )
      `,
      [
        Number(santri_id),
        amount,
        req.user?.id || user_id || null,
        trxId,
        tenantId
      ]
    );

   await client.query(
  `
  INSERT INTO audit_logs
  (
    device_id,
    event_type,
    detail,
    tenant_id
  )
  VALUES
  (
    $1,
    $2,
    $3,
    $4
  )
  `,
  [
    "BACKEND",
    "RFID_TOPUP",
    `${walletAccount.nama} | Rp ${amount}`,
    tenantId,
  ]
);

    await client.query(
      "COMMIT"
    );

    res.json({
      success:true,
      saldo_awal:
        saldoAwal,
      saldo_akhir:
        saldoAkhir
    });

  }

  catch(err){

    await client.query(
      "ROLLBACK"
    );

    console.log(err);

    sendUnitError(res, err, err.message || "Topup saldo gagal");

  }

  finally{

    client.release();

  }

};

exports.exportTransactions =
async(req,res)=>{

  try{
    const tenantId = req.tenantId;
    const access = await resolveWalletAccess(req);
    const { whereSql, params, joinSql } = buildTransactionFilters(
      tenantId,
      req.query,
      access,
      { applyDefaultDateRange: true },
    );

    const result =
      await pool.query(`
        SELECT
          wt.created_at,
          s.nama AS nama_santri,
          s.kamar,
          wt.type AS trx_type,
          m.nama_merchant,
          d.device_id,
          wt.amount AS nominal,
          NULL::bigint AS saldo_awal,
          wt.balance_after AS saldo_akhir,
          'synced'::text AS sync_status
        ${joinSql}
        WHERE ${whereSql}
        ORDER BY wt.created_at DESC
        LIMIT 10000
      `, params);

    const worksheet =
      XLSX.utils.json_to_sheet(
        result.rows
      );

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "RFID Transactions"
    );

    const buffer =
      XLSX.write(
        workbook,
        {
          type:"buffer",
          bookType:"xlsx"
        }
      );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=rfid-transactions.xlsx"
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(buffer);

  }

  catch(err){

    console.log(err);

    sendUnitError(res, err, "Export transaksi dompet gagal");

  }

};

exports.exportTopup =
async(req,res)=>{

  try{
    const tenantId = req.tenantId;
    const access = await resolveWalletAccess(req);
    const unitFilter = access.mode === "UNIT" ? " AND wt.unit_id = $2" : "";
    const params = access.mode === "UNIT" ? [tenantId, access.unitId] : [tenantId];

    const result =
      await pool.query(`
        SELECT
          wt.created_at,
          s.nama,
          wt.amount AS nominal,
          wt.actor_user_id AS created_by,
          wt.reference_id AS trx_id
        FROM wallet_transactions wt
        LEFT JOIN santri s ON s.id = wt.santri_id AND s.tenant_id = wt.tenant_id
        WHERE wt.type = 'topup'
          AND wt.tenant_id = $1${unitFilter}
        ORDER BY wt.created_at DESC
      `, params);

    const worksheet =
      XLSX.utils.json_to_sheet(
        result.rows
      );

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "RFID Topup"
    );

    const buffer =
      XLSX.write(
        workbook,
        {
          type:"buffer",
          bookType:"xlsx"
        }
      );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=rfid-topup.xlsx"
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(buffer);

  }

  catch(err){

    console.log(err);

    sendUnitError(res, err, "Export topup dompet gagal");

  }

};

exports.refundTransaction =
async(req,res)=>{

  const client =
    await pool.connect();

  const tenantId = req.tenantId;

  try{

    const {
      transaksi_id
    } = req.body;

    await client.query(
      "BEGIN"
    );

    const trx =
      await client.query(
        `
        SELECT *
        FROM transaksi_rfid
        WHERE id=$1
          AND tenant_id=$2
        `,
        [transaksi_id, tenantId]
      );

    if(
      trx.rows.length===0
    ){
      throw new Error(
        "Transaksi tidak ditemukan"
      );
    }

    const data =
      trx.rows[0];

    if (String(data.trx_type || "").toLowerCase() !== "payment") {
      throw new Error("Hanya transaksi pembayaran yang dapat direfund");
    }

    const refundMarker = `REFUND-OF-${transaksi_id}`;

    const alreadyRefunded = await client.query(
      `
        SELECT id
        FROM transaksi_rfid
        WHERE tenant_id = $1
          AND trx_type = 'refund'
          AND trx_id = $2
        LIMIT 1
      `,
      [tenantId, refundMarker]
    );

    if (alreadyRefunded.rows.length > 0) {
      throw new Error("Transaksi ini sudah pernah direfund");
    }

    const santri =
      await client.query(
        `
        SELECT *
        FROM santri
        WHERE id=$1
          AND tenant_id=$2
        `,
        [data.santri_id, tenantId]
      );

    const saldoAwal =
      Number(
        santri.rows[0].saldo
      );

    const saldoAkhir =
      saldoAwal +
      Number(data.nominal);

    await client.query(
      `
      UPDATE santri
      SET saldo=$1
      WHERE id=$2
        AND tenant_id=$3
      `,
      [
        saldoAkhir,
        data.santri_id,
        tenantId
      ]
    );

    await client.query(
      `
      INSERT INTO transaksi_rfid
      (
        trx_uuid,
        trx_id,
        santri_id,
        merchant_id,
        device_id,
        nominal,
        saldo_awal,
        saldo_akhir,
        trx_type,
        sync_status,
        tenant_id
      )
      VALUES
      (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'refund',
        'synced',
        $8
      )
      `,
      [
        refundMarker,
        data.santri_id,
        data.merchant_id,
        data.device_id,
        data.nominal,
        saldoAwal,
        saldoAkhir,
        tenantId
      ]
    );

    await client.query(
      `
      INSERT INTO audit_logs
      (
        device_id,
        event_type,
        detail,
        tenant_id
      )
      VALUES
      (
        'BACKEND',
        'RFID_REFUND',
        $1,
        $2
      )
      `,
      [
        `TRX ${data.trx_id}`,
        tenantId,
      ]
    );

    await client.query(
      "COMMIT"
    );

    res.json({
      success:true
    });

  }

  catch(err){

    await client.query(
      "ROLLBACK"
    );

    const message = err.message || "Refund gagal";
    const isBusinessError =
      message.includes("sudah pernah direfund") ||
      message.includes("Hanya transaksi pembayaran") ||
      message.includes("tidak ditemukan");

    res.status(isBusinessError ? 409 : 500).json({
      success:false,
      error: message
    });

  }

  finally{

    client.release();

  }

};

exports.getMutasi =
async(req,res)=>{

  try{
    const tenantId = req.tenantId;
    const access = await resolveWalletAccess(req, pool, { requireSpecific: true });

    const {
      santri_id
    } = req.query;

    const account = await getWalletAccountForSantri(pool, {
      tenantId,
      unitId: access.unitId,
      santriId: Number(santri_id),
    });
    if (!account) {
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }

    const result =
      await pool.query(
        `
        SELECT
          wt.created_at,
          wt.type AS trx_type,
          wt.amount AS nominal,
          NULL::bigint AS saldo_awal,
          wt.balance_after AS saldo_akhir,
          wt.reference_id AS trx_id,
          s.nama,
          s.uid_rfid,
          wa.current_balance AS saldo,
          wt.unit_id
        FROM wallet_transactions wt
        JOIN wallet_accounts wa
          ON wa.id = wt.wallet_account_id
         AND wa.tenant_id = wt.tenant_id
         AND wa.unit_id = wt.unit_id
        LEFT JOIN santri s ON s.id = wt.santri_id AND s.tenant_id = wt.tenant_id
        WHERE wt.santri_id = $1
          AND wt.tenant_id = $2
          AND wt.unit_id = $3
        ORDER BY wt.created_at DESC
        `,
        [santri_id, tenantId, access.unitId]
      );

    res.json({
      success:true,
      data:result.rows
    });

  }

  catch(err){

    console.log(err);

    sendUnitError(res, err, "Mutasi dompet gagal dimuat");

  }

};
