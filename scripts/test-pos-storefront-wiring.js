const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { createPosStorefrontRouter } = require('../routes/posStorefrontRoutes');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /createPosBusinessService\(\{ db: posBusinessDb \}\)/);
assert.match(serverSource, /createPosBusinessRouter\(\{ db: posBusinessDb, service: posBusinessService \}\)/);
assert.match(serverSource, /createPosStorefrontRouter\(\{ service: posBusinessService \}\)/);
assert.doesNotMatch(serverSource, /createPosStorefrontRouter\(\{\s*db:/);

const missing = Object.assign(new Error('Store not found'), { status: 404, code: 'STORE_NOT_FOUND' });
const service = {
  storefront: async () => { throw missing; },
  publicProduct: async () => { throw missing; },
  checkout: async () => { throw missing; },
  publicOrder: async () => { throw missing; },
  cancelOrder: async () => { throw missing; },
};
const app = express();
app.use('/store-api', createPosStorefrontRouter({ service }));
const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const { port } = server.address();
    for (const [route, method] of [
      ['/store-api/missing-store', 'GET'],
      ['/store-api/missing-store/products/1', 'GET'],
      ['/store-api/missing-store/orders', 'POST'],
      ['/store-api/missing-store/orders/order-1', 'GET'],
      ['/store-api/missing-store/orders/order-1/cancel', 'POST'],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? '{}' : undefined,
      });
      const body = await response.json();
      assert.equal(response.status, 404);
      assert.deepEqual(body, { success: false, code: 'STORE_NOT_FOUND' });
    }
    console.log('PASS storefront production composition shares a valid service');
    console.log('PASS unknown storefront and every existing storefront route return controlled 404');
  } finally { server.close(); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
