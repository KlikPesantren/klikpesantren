const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/FinancialWorkspace.jsx'),'utf8');
const backend=fs.readFileSync(path.join(__dirname,'../../services/posBusinessFinance.js'),'utf8');
test('clean cash flow exposes date filters while canonical audit filters remain available',()=>{
 for(const label of ['Tanggal awal','Tanggal akhir'])assert.ok(app.includes(label));
 for(const label of ['Semua akun','Semua jenis','Semua operator','Semua shift','Filter audit'])assert(!app.includes(label));
 for(const key of ['actor_id','shift_id','account_id','direction'])assert.ok(backend.includes(key));
});
test('one transfer event retains both legs and snapshot pagination remains virtualized',()=>{
 assert.match(app,/view:'events'/);assert.match(app,/detail\.legs/);assert.match(app,/from_account/);
 assert.match(app,/<FlatList/);assert.match(app,/next_cursor/);assert.match(backend,/pg_visible_in_snapshot/);
 assert.match(backend,/jsonb_agg/);assert.match(backend,/EVENT_VIEW_DATE_FILTER_ONLY/);
});
test('cash-flow summary has no shift audit navigation or private duplicate book',()=>{
 assert.doesNotMatch(app,/Audit Shift|Buku Kas Kasir/);assert.match(app,/total_events/);
});
