const express = require("express");
const service = require("../services/posMobileService");
// Parent /pos router supplies the existing canonical Admin auth/tenant middleware.
function createPosMobileRouter({ pos = service } = {}) {
  const router = express.Router();
  const handle = (op) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json({ success: true, data: await pos[op](req) });
    } catch (e) {
      const status = e.status || 500;
      if (status === 500)
        console.error("[POS mobile]", {
          operation: op,
          code: e.code || "INTERNAL",
        });
      res
        .status(status)
        .json({
          success: false,
          code: e.status ? e.code : "POS_INTERNAL_ERROR",
        });
    }
  };
  router.get("/context", handle("bootstrap"));
  router.get("/summary", handle("summary"));
  router.get("/catalog", handle("catalog"));
  router.post("/credential-preview", handle("preview"));
  router.get("/transactions", handle("history"));
  router.get("/transactions/:id", handle("sale"));
  router.get("/request-status", handle("lookup"));
  return router;
}
module.exports = { createPosMobileRouter };
