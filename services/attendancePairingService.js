const crypto = require("node:crypto");
const pool = require("../db");
const { resolveActiveUnit, assertUnitAccess, accessError } = require("./unitAccessService");
const { isFeatureEnabled } = require("./tenantFeatureService");
const { createOneTimeDeviceSecret } = require("../controllers/rfidDeviceController");
const { getPermissionList } = require("../middleware/requirePermission");

const PAIRING_LIFETIME_SECONDS = 15 * 60;
const verifier = (token) => crypto.createHash("sha256").update(token).digest("hex");
const safeColumns = "id,device_id,nama_device,unit_id,enabled,status,last_ping,firmware_version,last_sync,attendance_mode,merchant_id";

async function transaction(work) {
  const db = await pool.connect();
  try { await db.query("BEGIN"); const result = await work(db); await db.query("COMMIT"); return result; }
  catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

async function unitScope(req, db = pool) {
  const scope = await resolveActiveUnit(req, db);
  if (scope.mode !== "UNIT") throw accessError("Pilih satu unit", 400, "UNIT_REQUIRED");
  return scope;
}

async function audit(db, tenantId, deviceId, action, actorId) {
  await db.query(`INSERT INTO audit_logs(device_id,event_type,detail,tenant_id) VALUES($1,$2,$3,$4)`,
    [deviceId, action, JSON.stringify({ actor_user_id: actorId }), tenantId]);
}

async function list(req) {
  const scope = await unitScope(req);
  return (await pool.query(`SELECT ${safeColumns} FROM devices
    WHERE tenant_id=$1 AND unit_id=$2 ORDER BY id DESC`, [scope.tenantId, scope.unitId])).rows;
}

async function create(req) {
  return transaction(async (db) => {
    const scope = await unitScope(req, db);
    const name = String(req.body?.nama_device || "").trim();
    if (!name || name.length > 80) throw accessError("Nama perangkat wajib, maksimal 80 karakter", 400, "INVALID_DEVICE_NAME");
    // Device authority is generated server-side, never supplied by the phone.
    const deviceId = `EDC-${crypto.randomBytes(8).toString("hex")}`;
    const rows = await db.query(`INSERT INTO devices
      (tenant_id,unit_id,device_id,nama_device,device_secret,enabled,status,connection_state,attendance_mode)
      VALUES($1,$2,$3,$4,'__UNPAIRED__',false,'offline','offline','ATTENDANCE') RETURNING ${safeColumns}`,
    [scope.tenantId,scope.unitId,deviceId,name]);
    return issue(db, scope, rows.rows[0], req.user.id);
  });
}

async function target(req, db, scope) {
  const deviceId = String(req.params.deviceId || "").trim();
  const row = (await db.query(`SELECT ${safeColumns} FROM devices
    WHERE tenant_id=$1 AND device_id=$2 FOR UPDATE`, [scope.tenantId,deviceId])).rows[0];
  if (!row) throw accessError("Perangkat tidak ditemukan",404,"DEVICE_NOT_FOUND");
  if (Number(row.unit_id) !== scope.unitId) throw accessError("Perangkat di luar unit aktif");
  // Do not convert an existing POS/payment device through an Attendance endpoint.
  if (row.attendance_mode !== "ATTENDANCE") throw accessError("Bukan perangkat Absensi",409,"DEVICE_MODE_CONFLICT");
  return row;
}

async function issue(db, scope, device, actorId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query(`UPDATE attendance_device_pairings SET used_at=NOW()
    WHERE tenant_id=$1 AND device_id=$2 AND used_at IS NULL`, [scope.tenantId,device.id]);
  const row = (await db.query(`INSERT INTO attendance_device_pairings
    (tenant_id,device_id,verifier,issued_by,expires_at)
    VALUES($1,$2,$3,$4,NOW()+$5*INTERVAL '1 second') RETURNING expires_at`,
  [scope.tenantId,device.id,verifier(token),actorId,PAIRING_LIFETIME_SECONDS])).rows[0];
  await audit(db,scope.tenantId,device.device_id,"attendance.pairing.issued",actorId);
  return { device, pairing_code: token, expires_at: row.expires_at };
}

async function reissue(req) {
  return transaction(async (db) => {
    const scope = await unitScope(req,db);
    return issue(db,scope,await target(req,db,scope),req.user.id);
  });
}

async function edit(req) {
  return transaction(async (db) => {
    const scope = await unitScope(req,db);
    const device = await target(req,db,scope);
    const name = req.body.nama_device == null ? device.nama_device : String(req.body.nama_device).trim();
    const destination = req.body.assignment_unit_id == null ? scope.unitId : Number(req.body.assignment_unit_id);
    if (!name || name.length>80 || (req.body.enabled != null && typeof req.body.enabled!=="boolean"))
      throw accessError("Konfigurasi perangkat tidak valid",400,"INVALID_DEVICE_CONFIG");
    await assertUnitAccess(req.user,destination,scope.tenantId,db);
    const enabled = req.body.enabled == null ? device.enabled : req.body.enabled;
    // A blank/unpaired device cannot be enabled before it has an issued hash.
    const row = (await db.query(`UPDATE devices SET nama_device=$3,unit_id=$4,
      enabled=CASE WHEN device_secret_hash IS NOT NULL THEN $5 ELSE false END
      WHERE tenant_id=$1 AND id=$2 RETURNING ${safeColumns}`,
    [scope.tenantId,device.id,name,destination,enabled])).rows[0];
    // Assignment/disable invalidates outstanding pairing grants.
    await db.query(`UPDATE attendance_device_pairings SET used_at=NOW()
      WHERE tenant_id=$1 AND device_id=$2 AND used_at IS NULL`,[scope.tenantId,device.id]);
    await audit(db,scope.tenantId,device.device_id,"attendance.device.updated",req.user.id);
    return row;
  });
}

// Explicit opt-in for an existing unclassified, non-merchant device. No automatic
// historical backfill and no change to its credential, queue or payment mapping.
async function adopt(req) {
  return transaction(async(db)=>{
    const scope=await unitScope(req,db);
    if(req.body?.confirmation!=="ATTENDANCE") throw accessError("Konfirmasi mode Absensi wajib",400,"CONFIRMATION_REQUIRED");
    const device=(await db.query(`SELECT ${safeColumns} FROM devices
      WHERE tenant_id=$1 AND device_id=$2 FOR UPDATE`,[scope.tenantId,String(req.params.deviceId||"")])).rows[0];
    if(!device) throw accessError("Perangkat tidak ditemukan",404,"DEVICE_NOT_FOUND");
    if(Number(device.unit_id)!==scope.unitId) throw accessError("Perangkat di luar unit aktif");
    if(device.merchant_id!=null || (device.attendance_mode!=null && device.attendance_mode!=="ATTENDANCE"))
      throw accessError("Perangkat pembayaran tidak dapat diubah di sini",409,"DEVICE_MODE_CONFLICT");
    const result=(await db.query(`UPDATE devices SET attendance_mode='ATTENDANCE'
      WHERE tenant_id=$1 AND id=$2 RETURNING ${safeColumns}`,[scope.tenantId,device.id])).rows[0];
    await audit(db,scope.tenantId,device.device_id,"attendance.device.adopted",req.user.id);
    return result;
  });
}

async function redeem(token) {
  if (typeof token!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw accessError("Kode pairing tidak valid atau kedaluwarsa",401,"PAIRING_INVALID");
  // Existing feature/RBAC helpers use the pool themselves. Resolve them before
  // reserving a transactional client to avoid pool starvation on concurrent pairs.
  const found = (await pool.query(`SELECT p.tenant_id,p.device_id,p.issued_by,u.role
    FROM attendance_device_pairings p JOIN users u ON u.tenant_id=p.tenant_id AND u.id=p.issued_by
    WHERE p.verifier=$1`,[verifier(token)])).rows[0];
  if (!found) throw accessError("Kode pairing tidak valid atau kedaluwarsa",401,"PAIRING_INVALID");
  if (!(await isFeatureEnabled(found.tenant_id,"rfid")) || !(await isFeatureEnabled(found.tenant_id,"pendidikan")))
    throw accessError("Fitur Absensi RFID tidak tersedia",403,"FEATURE_DISABLED");
  if (!(await getPermissionList(found.role,{tenantScoped:true,tenantId:found.tenant_id})).includes("rfid.manage"))
    throw accessError("Otorisasi pairing dicabut",403,"PAIRING_UNAVAILABLE");
  return transaction(async (db) => {
    // Resolve IDs from the verifier first, then use the same device-first lock order
    // as Admin issuance/configuration. Lock+recheck makes concurrent redemption one-time.
    const device = (await db.query(`SELECT d.id,d.device_id,d.unit_id,d.attendance_mode,t.slug
      FROM devices d JOIN tenants t ON t.id=d.tenant_id
      JOIN unit_pendidikan u ON u.id=d.unit_id AND u.tenant_id=d.tenant_id AND u.is_active=true
      WHERE d.tenant_id=$1 AND d.id=$2 AND t.status='active' FOR UPDATE OF d`,
    [found.tenant_id,found.device_id])).rows[0];
    if (!device || device.attendance_mode!=="ATTENDANCE") throw accessError("Pairing tidak tersedia",403,"PAIRING_UNAVAILABLE");
    const pairing = (await db.query(`SELECT id,issued_by FROM attendance_device_pairings
      WHERE verifier=$1 AND tenant_id=$2 AND device_id=$3 AND used_at IS NULL
      AND expires_at>NOW() FOR UPDATE`,[verifier(token),found.tenant_id,found.device_id])).rows[0];
    if (!pairing) throw accessError("Kode pairing tidak valid atau kedaluwarsa",401,"PAIRING_INVALID");
    // Revalidate the issuer's still-active unit authority; revoked accounts cannot pair.
    await assertUnitAccess({id:pairing.issued_by},device.unit_id,found.tenant_id,db);
    const issuer = (await db.query("SELECT role FROM users WHERE tenant_id=$1 AND id=$2",[found.tenant_id,pairing.issued_by])).rows[0];
    if (!issuer || issuer.role!==found.role || pairing.issued_by!==found.issued_by)
      throw accessError("Otorisasi pairing dicabut",403,"PAIRING_UNAVAILABLE");
    const {plaintext,hash} = await createOneTimeDeviceSecret();
    await db.query(`UPDATE devices SET device_secret='__HASHED_V1__',device_secret_hash=$3,
      secret_rotated_at=NOW(),enabled=true WHERE tenant_id=$1 AND id=$2`,[found.tenant_id,device.id,hash]);
    await db.query("UPDATE attendance_device_pairings SET used_at=NOW() WHERE id=$1",[pairing.id]);
    await audit(db,found.tenant_id,device.device_id,"attendance.pairing.redeemed",pairing.issued_by);
    return {tenant_slug:device.slug,device_id:device.device_id,device_secret:plaintext,
      device_mode:"ATTENDANCE",unit_id:device.unit_id};
  });
}

module.exports = { list,create,edit,adopt,reissue,redeem,verifier,PAIRING_LIFETIME_SECONDS };
