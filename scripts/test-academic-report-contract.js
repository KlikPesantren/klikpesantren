const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const reports = require("../services/academicReportService");
const { buildAcademicReportPdf } = require("../services/academicReportPdfService");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let assertions = 0;
const ok = (value, message) => { assert.ok(value, message); assertions += 1; };

const migration = read("migrations/111_academic_semester_reports.sql");
const manifest = JSON.parse(read("docs/migration-baseline-manifest.json"));
const entry = manifest.migrations.find((item) => item.filename === "111_academic_semester_reports.sql");
ok(entry && entry.execution_order === 410, "migration 111 has explicit canonical order");
ok(entry.checksum === crypto.createHash("sha256").update(migration).digest("hex"), "migration checksum matches raw SQL");
ok(/CREATE TABLE academic_semester_grades/.test(migration), "semester grades use a dedicated table");
ok(!/ALTER TABLE nilai_mingguan/i.test(migration), "weekly grades are not rewritten");
ok(/academic_report_publications/.test(migration) && /snapshot JSONB NOT NULL/.test(migration), "published reports store immutable snapshots");
ok(/academic_report_ranking_finalizations/.test(migration), "class ranking has a frozen group record");

const ranking = reports.rankRows([
  { enrollment_id: 1, total: 190, subject_count: 2 },
  { enrollment_id: 2, total: 180, subject_count: 2 },
  { enrollment_id: 3, total: 180, subject_count: 2 },
  { enrollment_id: 4, total: 160, subject_count: 2 },
], 2);
ok(ranking.map((row) => row.rank).join(",") === "1,2,2,4", "ranking uses deterministic competition ranks");

const route = read("routes/academicReportRoutes.js");
ok(/requirePermission\('nilai\.manage'\)/.test(route), "write routes require grade management permission");
ok(/Pilih satu unit konkret/.test(route), "all-unit writes fail closed");
ok(/managerOnly/.test(route) && /REPORT_ADMIN_REQUIRED/.test(route), "approval, publication and administrative correction are manager-only");
ok(/Content-Type','application\/pdf'/.test(route), "admin PDF endpoint returns a PDF response");
const waliRoutes = read("routes/waliAppRoutes.js");
ok(/withWaliAuth/.test(waliRoutes) && /getPublicationForWali/.test(waliRoutes), "Wali routes use authenticated child-scoped publication access");
ok(/p\.is_current=true/.test(read("services/academicReportService.js")), "Wali sees only current published report versions");

const sample = {
  institution: { name: "Pesantren Uji", address: "Alamat Uji" }, unit_name: "SMP Uji",
  student: { name: "Santri Fixture", nis: "TEST-001" },
  period: { academic_year: "2026/2027", semester: "GANJIL" }, class_name: "VIII A",
  subjects: [{ name: "Matematika", final_score: 90, description: "Mencapai kompetensi" }],
  summary: { total: 90, average: 90 }, ranking: { rank: 1, participant_count: 28 },
  attendance: { sakit: 1, izin: 0, alfa: 0 }, homeroom_notes: "Terus berkembang",
  signer: { name: "Kepala Unit", title: "Kepala Sekolah" }, issue_place: "Kota Uji", issue_date: "2026-10-24",
};
const pdf = buildAcademicReportPdf(sample);
ok(pdf.subarray(0, 8).toString() === "%PDF-1.4", "PDF renderer emits a PDF 1.4 document");
ok(pdf.includes(Buffer.from("Peringkat 1 dari 28 santri")), "PDF uses the frozen X-of-Y ranking");

const page = read("frontend/src/pages/AcademicReportPage.jsx");
ok(/Nilai Mingguan hanya menjadi referensi dan tidak dihitung otomatis/i.test(page), "Admin clearly separates weekly and semester grades");
ok(/Alasan perbaikan/.test(page), "revision workflow collects an explicit reason");
ok(/Isi Nilai Rapor/.test(page) && /Lengkapi, Periksa, dan Setujui/.test(page) && /Terbitkan Rapor/.test(page), "Admin presents a four-stage non-technical report flow");
ok(/req\.body\?\.academic_semester_id/.test(read("routes/academicReportRoutes.js")), "GET report workspace accepts query input without requiring a request body");
const waliScreen = read("wali-app/src/screens/rapor/RaporScreen.jsx");
ok(/Rapor/.test(waliScreen) && /raporApi\.pdf/.test(waliScreen) && /Sharing\.shareAsync/.test(waliScreen), "Wali app exposes report summary and authenticated PDF download");

console.log(JSON.stringify({ status: "PASS", assertions }, null, 2));
