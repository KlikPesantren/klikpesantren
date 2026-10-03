const service = require("../services/attendancePairingService");

function handler(operation, status=200) {
  return async (req,res) => {
    res.set("Cache-Control","no-store"); res.set("Pragma","no-cache");
    try { return res.status(status).json({success:true,data:await operation(req)}); }
    catch(error) {
      // Never log body/token, SQL bind values, or provider errors containing credentials.
      return res.status(error.status || 500).json({success:false,
        code:error.status ? error.code : "ATTENDANCE_DEVICE_OPERATION_FAILED",
        error:error.status ? error.message : "Operasi perangkat gagal"});
    }
  };
}

// Public pairing is a bearer-token exchange, not self-registration. Bounded memory
// and an IP attempt window protect bcrypt/DB work; token entropy is the authority.
const attempts = new Map();
exports.pairingRateLimit = (req,res,next) => {
  const now=Date.now(), key=req.ip;
  for(const [ip,value] of attempts) if(value.until<=now) attempts.delete(ip);
  const value=attempts.get(key) || {count:0,until:now+60_000};
  if(value.count>=10 || (!attempts.has(key) && attempts.size>=10000))
    return res.status(429).json({success:false,code:"PAIRING_RATE_LIMITED"});
  value.count++; attempts.set(key,value); next();
};
exports.list=handler(service.list);
exports.create=handler(service.create,201);
exports.edit=handler(service.edit);
exports.adopt=handler(service.adopt);
exports.reissue=handler(service.reissue);
exports.redeem=handler(req=>service.redeem(req.body?.pairing_code));
