const router=require("express").Router();
const crypto=require("node:crypto"),pool=require("../db");
const permission=require("../middleware/requirePermission");
const {resolveAcademicUnit,getGuruInUnit,sendAcademicError}=require("../services/academicUnitService");
const {resolveOccurrence,getSessionUnits,applyAttendanceResult,recordAttendanceEvent,attendanceError}=require("../services/attendanceCoreService");

async function unit(req,db=pool){const scope=await resolveAcademicUnit(req,db);
  if(scope.mode!=="UNIT")throw attendanceError("UNIT_REQUIRED","Pilih satu unit",400);return scope;}

router.get("/guru/results",permission("absensi_guru.view"),async(req,res)=>{
  try{
    const scope=await unit(req);
    const month=Number(req.query.bulan),year=Number(req.query.tahun);
    if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(year)||year<2000||year>9999)
      throw attendanceError("INVALID_PERIOD","Periode tidak valid",400);
    const rows=await pool.query(`SELECT r.id,r.person_id AS guru_id,g.nama AS guru_nama,
      o.session_id,s.display_name,TO_CHAR(o.occurrence_date,'YYYY-MM-DD') AS tanggal,r.status,r.source,r.protected_manual
      FROM attendance_results r JOIN attendance_occurrences o ON o.tenant_id=r.tenant_id AND o.id=r.occurrence_id
      JOIN attendance_sessions s ON s.tenant_id=o.tenant_id AND s.id=o.session_id
      JOIN attendance_occurrence_units ou ON ou.tenant_id=o.tenant_id AND ou.occurrence_id=o.id
      JOIN guru g ON g.tenant_id=r.tenant_id AND g.id=r.person_id
      WHERE r.tenant_id=$1 AND ou.unit_id=$2 AND r.person_type='guru' AND o.state<>'cancelled'
      AND NOT (o.state='active' AND r.status='A' AND r.source='system' AND r.auto_generated
        AND r.provenance ? 'pending_schedule_edit_event_id')
      AND o.occurrence_date>=make_date($4,$3,1) AND o.occurrence_date<make_date($4,$3,1)+INTERVAL '1 month'
      AND EXISTS(SELECT 1 FROM guru_units gu WHERE gu.tenant_id=r.tenant_id AND gu.guru_id=r.person_id
        AND gu.unit_id=ou.unit_id AND (gu.joined_at IS NULL OR gu.joined_at<=o.occurrence_date)
        AND (gu.left_at IS NULL OR gu.left_at>=o.occurrence_date))
      ORDER BY o.occurrence_date,g.nama,s.id`,[req.tenantId,scope.unitId,month,year]);
    res.json({success:true,data:rows.rows});
  }catch(e){sendAcademicError(res,e);}
});

router.post("/guru/results",permission("absensi_guru.manage"),async(req,res)=>{
  let db;
  try{
    const date=String(req.body.tanggal||""),status=String(req.body.status||"");
    const parsed=new Date(`${date}T00:00:00Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||!["H","I","S","A"].includes(status))
      throw attendanceError("INVALID_ATTENDANCE_ENTRY","Tanggal/status tidak valid",400);
    db=await pool.connect();await db.query("BEGIN");
    const scope=await unit(req,db);
    await getGuruInUnit(req.tenantId,req.body.guru_id,scope.unitId,db);
    const units=await getSessionUnits(db,req.tenantId,req.body.session_id);
    if(!units.includes(scope.unitId))throw attendanceError("CROSS_UNIT_SESSION","Sesi di luar unit aktif",403);
    const occurrence=await resolveOccurrence({tenantId:req.tenantId,sessionId:req.body.session_id,occurrenceDate:date},db);
    const result=await applyAttendanceResult({tenantId:req.tenantId,occurrenceId:occurrence.id,
      personType:"guru",personId:req.body.guru_id,nextStatus:status,source:"admin",adminExplicit:true,
      actorUserId:req.user.id,effectiveAt:occurrence.window_start},db);
    if(result.changed)await recordAttendanceEvent({tenantId:req.tenantId,eventKey:`manual:${crypto.randomUUID()}`,
      provider:"admin",personType:"guru",personId:req.body.guru_id,occurrenceId:occurrence.id,
      capturedAt:new Date(),outcome:"admin_correction",provenance:{actor_user_id:req.user.id,status}},db);
    await db.query("COMMIT");res.json({success:true,data:result});
  }catch(e){if(db)await db.query("ROLLBACK");sendAcademicError(res,e);}
  finally{if(db)db.release();}
});
module.exports=router;
