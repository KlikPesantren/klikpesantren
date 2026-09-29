require("dotenv").config();

console.log(
  "SERVER INI YANG JALAN"
);

const express =
  require("express");

const cors =
  require("cors");

const http =
  require("http");

const {

  Server

} = require("socket.io");

const logger =
  require("./middleware/logger");

const notFound =
  require("./middleware/notFound");

const errorHandler =
  require("./middleware/errorHandler");

const { runStartupSchemaAudit } =
  require("./utils/schemaAudit");

const { logCloudflareStartupValidation } =
  require("./services/cloudflareDnsService");

const { logVercelStartupValidation } =
  require("./services/vercelDomainService");

// =====================
// ROUTES
// =====================

const authRoutes =
  require("./routes/authRoutes");

const platformAuthRoutes =
  require("./routes/platformAuthRoutes");

const platformTenantRoutes =
  require("./routes/platformTenantRoutes");

const platformBrandRoutes =
  require("./routes/platformBrandRoutes");

const publicBrandRoutes =
  require("./routes/publicBrandRoutes");

const platformTenantDomainRoutes =
  require("./routes/platformTenantDomainRoutes");

const platformStatsRoutes =
  require("./routes/platformStatsRoutes");

const publicTenantRoutes =
  require("./routes/publicTenantRoutes");

const publicPlatformRoutes =
  require("./routes/publicPlatformRoutes");

const platformSettingsRoutes =
  require("./routes/platformSettingsRoutes");

const platformAnnouncementRoutes =
  require("./routes/platformAnnouncementRoutes");

const {
  platformWebsiteRoutes,
  publicWebsiteRoutes,
} = require("./routes/platformWebsiteRoutes");

const platformBackupRoutes =
  require("./routes/platformBackupRoutes");

const santriRoutes =
  require("./routes/santriRoutes");

const alumniRoutes =
  require("./routes/alumniRoutes");

const transaksiRoutes =
  require("./routes/transaksiRoutes");

const deviceRoutes =
  require("./routes/deviceRoutes");

const auditApi =
  require("./routes/auditApi");

const kelasRoutes =
  require("./routes/kelasRoutes");

const dashboardRoutes =
require("./routes/dashboardRoutes");

const dashboardSpecificUnitRoutes =
require("./routes/dashboardSpecificUnitRoutes");

const unitRoutes =
require("./routes/unitRoutes");

const waliRoutes =
require("./routes/waliRoutes");

const pembayaranRoutes =
require("./routes/pembayaranRoutes");

const jenisTagihanRoutes =
require("./routes/jenisTagihanRoutes");

const absensiRoutes =
require("./routes/absensiRoutes");

const attendanceSessionRoutes =
require("./routes/attendanceSessionRoutes");

const perizinanRoutes =
require("./routes/perizinanRoutes");

const pelanggaranRoutes =
require("./routes/pelanggaranRoutes");

const kesehatanRoutes =
require("./routes/kesehatanRoutes");

const hafalanRoutes =
require("./routes/hafalanRoutes");

const nilaiRoutes =
  require("./routes/nilaiRoutes");
const mataPelajaranRoutes =
  require("./routes/mataPelajaranRoutes");

const bukuKasRoutes =
require( "./routes/bukuKasRoutes" );

const kasInstansiRoutes =
require("./routes/kasInstansiRoutes");

const programUnitRoutes =
require("./routes/programUnitRoutes");

const sahriyahRoutes =
require( "./routes/sahriyahRoutes" );

const sahriyahSettingRoutes =
require(
"./routes/sahriyahSettingRoutes"
);

const invoiceRoutes =
require("./routes/invoiceRoutes");

const tamuRoutes =
require("./routes/tamuRoutes");

const rfidRoutes =
require("./routes/rfidRoutes");

const rfidMerchantRoutes =
require(
"./routes/rfidMerchantRoutes"
);

const rfidDeviceRoutes =
require(
"./routes/rfidDeviceRoutes"
);

const rfidSyncRoutes =
require(
"./routes/rfidSyncRoutes"
);

const rfidMonitorRoutes =
require("./routes/rfidMonitorRoutes");

const rfidAuditRoutes =
require(
"./routes/rfidAuditRoutes"
);

const waliAppRoutes =
require("./routes/waliAppRoutes");

const pengumumanRoutes =
require("./routes/pengumumanRoutes");

const waliHomeLinkRoutes =
require("./routes/waliHomeLinkRoutes");

const path = require("path");

const uploadRoutes =
require("./routes/uploadRoutes");

const profilPesantrenRoutes =
require("./routes/profilPesantrenRoutes");

const userRoutes =
require("./routes/userRoutes");

const roleRoutes =
require("./routes/roleRoutes");

const guruRoutes =
require("./routes/guruRoutes");
// =====================
// RBAC MIDDLEWARE
// =====================

const authMiddleware =
  require("./middleware/authMiddleware");

const tenantMiddleware =
  require("./middleware/tenantMiddleware");

const requirePermission =
require("./middleware/requirePermission");

const requireTenantFeature =
  require("./middleware/requireTenantFeature");

const requireUnitFeature =
  require("./middleware/requireUnitFeature");

const blockWriteUnlessPermission =
require("./middleware/blockWriteUnlessPermission");

// =====================
// APP
// =====================

const app =
  express();

const server =
  http.createServer(app);

const io =
  new Server(

    server,

    {

      cors: {

        origin:
          process.env.CORS_ORIGIN ||
          process.env.FRONTEND_URL ||
          "http://10.10.2.140:5173",

        methods: [

          "GET",
          "POST",
          "PUT",
          "DELETE"

        ]

      }

    }

);

app.set("io", io);

// =====================
// MIDDLEWARE
// =====================

app.use(cors());

app.use(express.json({ limit: "2mb" }));

app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

app.use(logger);

// =====================
// ROOT
// =====================

app.get(

  "/",

  (req, res) => {

    res.send(

      "API Administrasi Santri Digital AKTIF"

    );

  }

);

// =====================
// ROUTES
// =====================

app.use(

  "/auth",

  authRoutes

);

app.use(
  "/platform/auth",
  platformAuthRoutes
);

app.use(
  "/platform/tenants",
  platformTenantRoutes
);

app.use(
  "/platform/brands",
  platformBrandRoutes
);

app.use(
  "/platform",
  platformTenantDomainRoutes
);

app.use(
  "/platform/stats",
  platformStatsRoutes
);

app.use(
  "/platform/settings",
  platformSettingsRoutes
);

app.use(
  "/platform/announcements",
  platformAnnouncementRoutes
);

app.use(
  "/platform/website",
  platformWebsiteRoutes
);

app.use(
  "/platform/backup",
  platformBackupRoutes
);

app.use(
  "/public/tenants",
  publicTenantRoutes
);

app.use(
  "/public/platform",
  publicPlatformRoutes
);

app.use(
  "/public/app-brands",
  publicBrandRoutes
);

app.use(
  "/public/website",
  publicWebsiteRoutes
);

app.use(

  "/santri",

  santriRoutes

);

app.use("/alumni", alumniRoutes);

app.use(

  "/transaksi",

  transaksiRoutes

);

app.use(

  "/devices",

  deviceRoutes

);

app.use(
  "/audit",
  authMiddleware,
  tenantMiddleware,
  requirePermission("audit.view"),
  auditApi
);

app.use(

  "/kelas",

  kelasRoutes

);

app.use(
  "/dashboard",
  authMiddleware,
  tenantMiddleware,
  requirePermission("dashboard.view"),
  dashboardRoutes
);

app.use(
  "/dashboard-specific-unit",
  authMiddleware,
  tenantMiddleware,
  requirePermission("dashboard.view"),
  dashboardSpecificUnitRoutes
);

app.use("/units", unitRoutes);

app.use(
  "/wali",
  authMiddleware,
  requirePermission("wali.view"),
  waliRoutes
);

app.use(
  "/pembayaran",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("pembayaran"),
  requirePermission("pembayaran.view"),
  pembayaranRoutes
);

app.use(
  "/jenis-tagihan",
  authMiddleware,
  tenantMiddleware,
  requirePermission("tagihan.view"),
  jenisTagihanRoutes
);

app.use(
  "/absensi",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("absensi"),
  requirePermission("absensi.view"),
  absensiRoutes
);

app.use(
  "/attendance-sessions",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("absensi"),
  requirePermission("absensi.view"),
  attendanceSessionRoutes
);

app.use(
  "/perizinan",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("perizinan"),
  requirePermission("perizinan.view"),
  perizinanRoutes
);

app.use(
  "/kesehatan",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("kesehatan"),
  requirePermission("kesehatan.view"),
  kesehatanRoutes
);

app.use(
  "/pelanggaran",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("pelanggaran"),
  requirePermission("pelanggaran.view"),
  pelanggaranRoutes
);

app.use(
  "/hafalan",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("hafalan"),
  requirePermission("hafalan.view"),
  hafalanRoutes
);

app.use(
  "/nilai",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("nilai"),
  requirePermission("nilai.view"),
  nilaiRoutes
);
app.use(
  "/mata-pelajaran",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("mata_pelajaran"),
  requirePermission("nilai.view"),
  mataPelajaranRoutes
);

app.use(
  "/pengumuman",
  authMiddleware,
  tenantMiddleware,
  requireUnitFeature("pengumuman"),
  requirePermission("pengumuman.view"),
  pengumumanRoutes
);

app.use(
  "/wali-home-links",
  authMiddleware,
  tenantMiddleware,
  requirePermission("konten_pesantren.view"),
  waliHomeLinkRoutes
);

app.use(
  "/profil-pesantren",
  authMiddleware,
  tenantMiddleware,
  profilPesantrenRoutes
);

app.use(
  "/upload",
  authMiddleware,
  tenantMiddleware,
  requirePermission.requireAnyPermission([
    "profil.view",
    "profil.manage",
    "santri.manage",
    "pengumuman.manage",
    "konten_pesantren.manage",
  ]),
  uploadRoutes
);

console.log("ROUTE REGISTERED: POST /upload/image");

app.use(
  "/users",
  userRoutes
);

app.use(
  "/roles",
  roleRoutes
);

app.use(
  "/guru", guruRoutes);

app.use(

  "/absensi-guru",

  authMiddleware,
  tenantMiddleware,
  requirePermission("absensi_guru.view"),

  require(

    "./routes/absensiGuruRoutes"

  )

);

app.use(

  "/buku-kas",

  authMiddleware,
  tenantMiddleware,
  requirePermission("bukukas.view"),
  blockWriteUnlessPermission("bukukas.manage"),

  bukuKasRoutes

);

app.use(
  "/kas-instansi",
  authMiddleware,
  tenantMiddleware,
  requireTenantFeature("kas_instansi"),
  kasInstansiRoutes
);

app.use(
  "/program-unit",
  authMiddleware,
  tenantMiddleware,
  programUnitRoutes
);

app.use(
"/sahriyah",
authMiddleware,
tenantMiddleware,
requireTenantFeature("sahriyah"),
requireUnitFeature("sahriyah"),
requirePermission("sahriyah.view"),
sahriyahRoutes
);

app.use(
"/sahriyah-setting",
authMiddleware,
tenantMiddleware,
requireTenantFeature("sahriyah"),
requireUnitFeature("sahriyah"),
requirePermission("sahriyah.manage"),
sahriyahSettingRoutes
);

app.use(
"/invoice",
authMiddleware,
tenantMiddleware,
requireTenantFeature("sahriyah"),
requirePermission("sahriyah.view"),
invoiceRoutes
);

app.use(
  "/tamu",
  authMiddleware,
  tenantMiddleware,
  requirePermission("tamu.view"),
  tamuRoutes
);

app.use(
  "/rfid",
  rfidRoutes
);

app.use(
  "/rfid/merchant",
  rfidMerchantRoutes
);

app.use(
  "/rfid/device",
  rfidDeviceRoutes
);

app.use(
  "/rfid/sync",
  rfidSyncRoutes
);

app.use(
  "/rfid/monitor",
  rfidMonitorRoutes
);

app.use(
  "/rfid/audit",
  rfidAuditRoutes
);

app.use(
  "/wali-app",
  waliAppRoutes
);

// =====================
// ERROR HANDLER
// =====================

app.use(notFound);

app.use(errorHandler);

// =====================
// SOCKET
// =====================

io.on(

  "connection",

  (socket) => {

    console.log(

      "SOCKET CONNECTED:",
      socket.id

    );

    socket.on(

      "disconnect",

      () => {

        console.log(

          "SOCKET DISCONNECTED:",
          socket.id

        );

      }

    );

  }

);

// =====================
// START SERVER
// =====================

const PORT =
  process.env.PORT || 3000;

const {
  enforceAllTenantBillingExpiries,
} = require("./services/tenantBillingEnforcementService");

function startTenantBillingEnforcement() {
  const enforce = () => enforceAllTenantBillingExpiries()
    .then((rows) => {
      if (rows.length) {
        console.log(`[BILLING] Auto-suspended expired tenants: ${rows.length}`);
      }
    })
    .catch((error) => console.error("[BILLING] Expiry enforcement failed:", error.message));

  enforce();
  const timer = setInterval(enforce, 60 * 60 * 1000);
  timer.unref();
}

server.listen(

  PORT,

  () => {

    console.log(

      `SERVER RUNNING PORT ${PORT}`

    );

    console.log("SERVER STARTED");
    console.log("PORT:", PORT);
    console.log("HOST: 0.0.0.0 (all interfaces)");

    logCloudflareStartupValidation();
    logVercelStartupValidation();

    runStartupSchemaAudit().catch((err) => {

      console.error("[SCHEMA AUDIT] Startup check failed:", err.message);

    });

    startTenantBillingEnforcement();

  }

);
