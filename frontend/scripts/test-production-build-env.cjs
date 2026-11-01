const assert=require('node:assert/strict');
const {validateProductionApiBase}=require('./production-build-env.cjs');
assert.equal(validateProductionApiBase(' https://api.klikpesantren.com/ '),'https://api.klikpesantren.com');
for(const value of ['',undefined,'not-a-url','http://127.0.0.1:55440','https://user:password@example.test','https://example.test?token=x','https://example.test#fragment'])assert.throws(()=>validateProductionApiBase(value));
console.log('PASS production frontend API guard: valid HTTPS accepted; missing/invalid/HTTP/credentials/query/fragment rejected');
