const {spawnSync}=require('node:child_process');
const path=require('node:path');
const tests=[
  'test-attendance-v1-phase1','test-attendance-v1-phase2a','test-attendance-hybrid-v1',
  'test-attendance-hybrid-host','test-attendance-pairing','test-attendance-phone-setup',
  'test-attendance-auto-alfa','test-attendance-read-contract','test-attendance-uid-boundary',
  'test-attendance-sessions','test-multi-unit-foundation','test-multi-unit-santri-kelas',
  'test-guru-unit-scope','test-academic-multi-unit','test-absensi-batch-save',
  'test-attendance-device-secret-rotation','test-rfid-online-offline-policy',
  'test-wallet-core-separation','test-wali-jwt-hardening','test-sahriyah-kpi-summary',
  'test-migration-reconciliation','test-branding-domain-contract',
];
const env={...process.env,DB_HOST:'localhost',DB_USER:'synthetic',DB_PASSWORD:'synthetic',DB_NAME:'synthetic',
  JWT_SECRET:'synthetic-final-test-only',WALI_JWT_SECRET:'synthetic-wali-final-test-only'};
for(const test of tests){
  const result=spawnSync(process.execPath,[path.join(__dirname,`${test}.js`)],{env,stdio:'inherit'});
  if(result.error || result.status!==0){console.error(`FAIL ${test}`);process.exit(1);}
  console.log(`PASS command: node scripts/${test}.js`);
}
console.log(`PASS source/executable suites ${tests.length}/${tests.length}; PostgreSQL rehearsal, production read smoke, lint/build and ESP32 compile are separate mandatory commands.`);
