const express=require('express');
const pool=require('../db');
const requirePermission=require('../middleware/requirePermission');
const {resolveAcademicUnit,sendAcademicError}=require('../services/academicUnitService');
const service=require('../services/academicReportService');
const {buildAcademicReportPdf}=require('../services/academicReportPdfService');
const router=express.Router();

async function scope(req){const access=await resolveAcademicUnit(req);if(access.mode==='ALL')throw service.reportError('UNIT_REQUIRED','Pilih satu unit konkret untuk operasi E-Rapor',400);return{tenantId:req.tenantId,unitId:access.unitId,actorId:req.user.id,isManager:['superadmin','pendidikan'].includes(req.user.role)};}
// Tenant, unit, actor and manager authority always come from the server context.
const input=(req,base)=>({...(req.body||{}),...base,semesterId:req.body?.academic_semester_id??req.query?.academic_semester_id,kelasId:req.body?.kelas_id??req.query?.kelas_id,configId:req.body?.config_version_id??req.query?.config_version_id});
const handle=(fn)=>(async(req,res)=>{try{const base=await scope(req);const data=await fn(req,input(req,base));res.json({success:true,data});}catch(error){sendAcademicError(res,error);}});
const managerOnly=(fn)=>handle((req,payload)=>{if(!payload.isManager)throw service.reportError('REPORT_ADMIN_REQUIRED','Hanya Admin Pendidikan yang dapat melakukan tindakan ini',403);return fn(req,payload);});

router.get('/workspace',handle((req,payload)=>service.listWorkspace(pool,payload)));
router.post('/config',requirePermission('nilai.manage'),managerOnly((req,payload)=>service.createConfig(pool,payload)));
router.post('/teacher-assignments',requirePermission('nilai.manage'),managerOnly((req,payload)=>service.assignTeacher(pool,payload)));
router.put('/grades',requirePermission('nilai.manage'),handle((req,payload)=>service.saveGrades(pool,payload)));
router.post('/grades/:id/corrections',requirePermission('nilai.manage'),managerOnly((req,payload)=>service.correctSemesterGrade(pool,{...payload,gradeId:Number(req.params.id)})));
router.put('/reports/:id/notes',requirePermission('nilai.manage'),handle((req,payload)=>service.saveReportNotes(pool,{...payload,enrollmentId:Number(req.params.id)})));
router.post('/reports/:id/workflow',requirePermission('nilai.manage'),handle((req,payload)=>{if(payload.to_status!=='REVIEW'&&!payload.isManager)throw service.reportError('REPORT_ADMIN_REQUIRED','Hanya Admin Pendidikan yang dapat menyetujui atau meminta revisi',403);return service.transitionReport(pool,{...payload,reportCardId:Number(req.params.id)});}));
router.get('/ranking/preview',handle((req,payload)=>service.previewRanking(pool,payload)));
router.post('/ranking/finalize',requirePermission('nilai.manage'),managerOnly((req,payload)=>service.finalizeRanking(pool,payload)));
router.post('/publish',requirePermission('nilai.manage'),managerOnly((req,payload)=>service.publishClass(pool,payload)));
router.post('/reports/:id/revisions',requirePermission('nilai.manage'),managerOnly((req,payload)=>service.createRevision(pool,{...payload,reportCardId:Number(req.params.id)})));
router.get('/publications/:id/pdf',async(req,res)=>{try{const payload=await scope(req);const row=(await pool.query(`SELECT p.snapshot FROM academic_report_publications p WHERE p.tenant_id=$1 AND p.unit_id=$2 AND p.id=$3`,[payload.tenantId,payload.unitId,Number(req.params.id)])).rows[0];if(!row)throw service.reportError('REPORT_NOT_FOUND','Rapor terbit tidak ditemukan',404);const pdf=buildAcademicReportPdf(row.snapshot);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="rapor-${Number(req.params.id)}.pdf"`);res.send(pdf);}catch(error){sendAcademicError(res,error);}});

module.exports=router;
