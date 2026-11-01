// HTTP route contract without database/network: client input cannot replace scope.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../routes/academicReportRoutes.js');
const routes = new Map();
const captured = [];
const router = {};
for (const method of ['get', 'post', 'put']) {
  router[method] = (route, ...handlers) => routes.set(`${method} ${route}`, handlers);
}
const service = new Proxy({
  reportError: (code, message, status) => Object.assign(new Error(message), {code, status}),
}, {get(target, key) {
  return target[key] || (async (_db, payload) => {captured.push({key, payload}); return {};});
}});
const mocks = {
  express: {Router: () => router},
  '../db': {},
  '../middleware/requirePermission': () => (_req, _res, next) => next(),
  '../services/academicUnitService': {
    resolveAcademicUnit: async () => ({mode: 'UNIT', unitId: 20}),
    sendAcademicError: (res, error) => res.status(error.status || 500).json({code: error.code}),
  },
  '../services/academicReportService': service,
  '../services/academicReportPdfService': {buildAcademicReportPdf() {throw Error('Unexpected PDF');}},
};
vm.runInThisContext(require('node:module').wrap(fs.readFileSync(file, 'utf8')), {filename: file})(
  {}, name => {assert(name in mocks, `Unexpected dependency ${name}`); return mocks[name];},
  {exports: {}}, file, __dirname,
);
async function invoke(route, role, body) {
  const response = {statusCode: 200, status(code) {this.statusCode = code; return this;}, json(value) {this.value = value;}};
  const req = {tenantId: 10, user: {id: 30, role}, body, query: {}, params: {id: '40'}};
  const handlers = routes.get(route);
  assert(handlers, route);
  // Parent authentication/permission middleware is outside this isolated contract.
  await handlers.at(-1)(req, response);
  return response;
}
(async () => {
  const hostile = {tenantId: 999, unitId: 999, actorId: 999, isManager: true,
    academic_semester_id: 4, kelas_id: 5, config_version_id: 6};
  let checks = 0;
  for (const route of ['get /workspace', 'put /grades', 'put /reports/:id/notes',
    'post /reports/:id/workflow', 'get /ranking/preview']) {
    const response = await invoke(route, 'guru', {...hostile, to_status: 'REVIEW'});
    assert.equal(response.statusCode, 200);
    const payload = captured.at(-1).payload;
    assert.deepEqual([payload.tenantId, payload.unitId, payload.actorId, payload.isManager], [10, 20, 30, false]);
    assert.deepEqual([payload.semesterId, payload.kelasId, payload.configId], [4, 5, 6]);
    checks++;
  }
  for (const route of ['post /config', 'post /teacher-assignments', 'post /grades/:id/corrections',
    'post /ranking/finalize', 'post /publish', 'post /reports/:id/revisions']) {
    const before = captured.length;
    assert.equal((await invoke(route, 'guru', hostile)).statusCode, 403);
    assert.equal(captured.length, before, 'spoofed manager must never reach service');
    assert.equal((await invoke(route, 'pendidikan', {...hostile, isManager: false})).statusCode, 200);
    const payload = captured.at(-1).payload;
    assert.deepEqual([payload.tenantId, payload.unitId, payload.actorId, payload.isManager], [10, 20, 30, true]);
    checks++;
  }
  const before = captured.length;
  assert.equal((await invoke('post /reports/:id/workflow', 'guru', {...hostile, to_status: 'APPROVED'})).statusCode, 403);
  assert.equal(captured.length, before);
  checks++;
  console.log(JSON.stringify({status: 'PASS', checks, scope: 'server tenant/unit/actor/role authoritative', databaseQueries: 0}));
})().catch(error => {console.error(error.message); process.exitCode = 1;});
