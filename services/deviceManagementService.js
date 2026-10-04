const pool = require('../db');
const {resolveActiveUnit, accessError} = require('./unitAccessService');
const safeColumns = 'id,device_id,nama_device,unit_id,enabled,status,last_ping,firmware_version,last_sync,attendance_mode,merchant_id';

async function transaction(req, work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const scope = await resolveActiveUnit(req, db);
    if (scope.mode !== 'UNIT') throw accessError('Pilih satu unit',400,'UNIT_REQUIRED');
    const device = (await db.query(`SELECT ${safeColumns},
      (attendance_mode='ATTENDANCE' AND merchant_id IS NULL AND enabled=false
       AND device_secret='__UNPAIRED__' AND device_secret_hash IS NULL
       AND secret_rotated_at IS NULL AND last_authenticated_at IS NULL
       AND last_ping IS NULL AND last_sync IS NULL) AS deletion_candidate
      FROM devices WHERE tenant_id=$1 AND device_id=$2 FOR UPDATE`,
    [scope.tenantId,String(req.params.deviceId || '').trim()])).rows[0];
    if (!device) throw accessError('Perangkat tidak ditemukan',404,'DEVICE_NOT_FOUND');
    if (Number(device.unit_id)!==scope.unitId) throw accessError('Perangkat di luar unit aktif');
    const result = await work(db,scope,device);
    await db.query('COMMIT');return result;
  } catch(error) {await db.query('ROLLBACK');throw error;}
  finally {db.release();}
}

async function audit(db,scope,device,actorId,event) {
  await db.query('INSERT INTO audit_logs(tenant_id,device_id,event_type,detail) VALUES($1,$2,$3,$4)',
    [scope.tenantId,device.device_id,event,JSON.stringify({actor_user_id:actorId})]);
}

async function rename(req) {
  const name = typeof req.body?.nama_device==='string' ? req.body.nama_device.trim() : '';
  if (!name || name.length>80) throw accessError('Nama perangkat wajib, maksimal 80 karakter',400,'INVALID_DEVICE_NAME');
  return transaction(req,async(db,scope,device)=>{
    // Display name only: do not invalidate pairing or touch unit/auth/history.
    const result=(await db.query(`UPDATE devices SET nama_device=$3
      WHERE tenant_id=$1 AND id=$2 RETURNING ${safeColumns}`,[scope.tenantId,device.id,name])).rows[0];
    await audit(db,scope,device,req.user.id,'attendance.device.renamed');
    return result;
  });
}

async function remove(req) {
  if(req.body?.confirmation!=='DELETE' || req.body?.confirmation_device_id!==req.params.deviceId)
    throw accessError('Konfirmasi target perangkat wajib',400,'CONFIRMATION_REQUIRED');
  return transaction(req,async(db,scope,device)=>{
    // Only an unpaired, disabled, never-authenticated Attendance device is provably
    // unused. Legacy/provisioned devices fail closed; use existing disable action.
    // Pairing redemption uses the SAME device-first FOR UPDATE lock. A pending
    // redemption cannot enable/authenticate this candidate between check/delete.
    if(!device.deletion_candidate) throw accessError('Perangkat pernah digunakan atau status legacy belum dapat dibuktikan. Nonaktifkan untuk mempertahankan histori.',409,'DEVICE_HISTORY_PROTECTED');
    const refs=(await db.query(`SELECT
      EXISTS(SELECT 1 FROM attendance_events WHERE device_id=$1) OR
      EXISTS(SELECT 1 FROM wallet_transactions WHERE device_id=$1) OR
      EXISTS(SELECT 1 FROM transaksi_rfid WHERE device_id=$1) OR
      EXISTS(SELECT 1 FROM rfid_sync_queue WHERE device_id=$1) OR
      EXISTS(SELECT 1 FROM attendance_device_pairings WHERE device_id=$1 AND used_at IS NOT NULL) OR
      EXISTS(SELECT 1 FROM audit_logs WHERE device_id=$2 AND (tenant_id=$3 OR tenant_id IS NULL)
        AND event_type NOT IN ('attendance.pairing.issued','attendance.device.updated','attendance.device.renamed'))
      AS referenced`,[device.id,device.device_id,scope.tenantId])).rows[0];
    if(refs.referenced) throw accessError('Perangkat memiliki histori. Nonaktifkan perangkat; histori tetap dipertahankan.',409,'DEVICE_HISTORY_PROTECTED');
    // Refuse an unforeseen cascading relationship, never silently erase new history.
    const unknown=(await db.query(`SELECT count(*)::int AS n FROM pg_constraint
      WHERE contype='f' AND confrelid='public.devices'::regclass
      AND NOT ((conrelid=to_regclass('public.attendance_device_pairings') AND conname='attendance_pairing_device_tenant_fkey' AND confdeltype='c')
        OR (conrelid=to_regclass('public.attendance_events') AND conname='attendance_events_device_tenant_fkey' AND confdeltype='a'))`)).rows[0];
    if(unknown.n) throw accessError('Referensi perangkat memerlukan review',409,'DEVICE_REFERENCE_REVIEW_REQUIRED');
    await audit(db,scope,device,req.user.id,'attendance.device.deleted');
    const result=await db.query('DELETE FROM devices WHERE tenant_id=$1 AND id=$2 RETURNING device_id',[scope.tenantId,device.id]);
    if(result.rowCount!==1) throw accessError('Perangkat tidak ditemukan',404,'DEVICE_NOT_FOUND');
    // Only unused pairing grants cascade; operational/audit history is never deleted.
    return {device_id:device.device_id,deleted:true};
  });
}

module.exports={rename,remove};
