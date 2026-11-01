const express=require('express');
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const tenant=require('../middleware/tenantMiddleware');
const requirePermission=require('../middleware/requirePermission');
const requireUnitFeature=require('../middleware/requireUnitFeature');
const {resolveActiveUnit}=require('../services/unitAccessService');
const {createAcademicPeriodService}=require('../services/academicPeriodService');
const router=express.Router(), service=createAcademicPeriodService(pool);
const base=[auth,tenant,requireUnitFeature('kelas')];
function sendError(res,e){res.status(e.status||500).json({success:false,code:e.code,error:(e.status||500)>=500?'Gagal memproses periode akademik':e.message});}
async function context(req,write=true){const w=await resolveActiveUnit(req);if(write&&w.mode!=='UNIT'){const e=new Error('Pilih satu unit konkret untuk perubahan akademik');e.status=400;e.code='UNIT_REQUIRED';throw e;}return{tenantId:req.tenantId,unitId:w.unitId,userId:req.user.id};}
router.get('/',...base,requirePermission('kelas.view'),async(req,res)=>{try{const c=await context(req,false);res.json({success:true,data:await service.list(c.tenantId,c.unitId)});}catch(e){sendError(res,e);}});
router.post('/years',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.status(201).json({success:true,data:await service.createYear(await context(req),req.body)});}catch(e){sendError(res,e);}});
router.post('/semesters',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.status(201).json({success:true,data:await service.createSemester(await context(req),req.body)});}catch(e){sendError(res,e);}});
router.post('/levels',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.status(201).json({success:true,data:await service.createLevel(await context(req),req.body)});}catch(e){sendError(res,e);}});
router.patch('/classes/:id/level',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.json({success:true,data:await service.mapClass(await context(req),req.params.id,req.body.academic_grade_level_id)});}catch(e){sendError(res,e);}});
router.post('/semesters/:id/:action',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.json({success:true,data:await service.transitionSemester(await context(req),req.params.id,req.params.action)});}catch(e){sendError(res,e);}});
router.post('/years/:id/:action',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.json({success:true,data:await service.transitionYear(await context(req),req.params.id,req.params.action)});}catch(e){sendError(res,e);}});
router.post('/promotions/preview',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.json({success:true,data:await service.preview(await context(req),req.body)});}catch(e){sendError(res,e);}});
router.post('/promotions/execute',...base,requirePermission('kelas.manage'),async(req,res)=>{try{res.json({success:true,data:await service.execute(await context(req),req.body)});}catch(e){sendError(res,e);}});
router.post('/grades/:id/corrections',...base,requirePermission('nilai.manage'),async(req,res)=>{try{res.json({success:true,data:await service.correctClosedGrade(await context(req),req.params.id,req.body)});}catch(e){sendError(res,e);}});
module.exports=router;
