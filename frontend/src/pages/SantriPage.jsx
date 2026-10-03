import { useEffect, useMemo, useState } from "react";
import { canonicalAttendanceUid } from "../utils/attendanceRfidUid";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import {
  Table,
  TableScroll,
  TableActions,
  TablePagination,
  useClientPagination,
} from "../components/ui/table";
import {
  FormField,
  Input,
  Select,
  Textarea,
  FormGrid,
  FormSection,
  FormActionBar,
} from "../components/ui/form";
import Modal from "../components/Modal";
import { exportExcel } from "../utils/exportExcel";
import SantriImportModal from "../components/santri/SantriImportModal";
import SantriOperationalChecklist from "../components/santri/SantriOperationalChecklist";
import ImageUploadField from "../components/ImageUploadField";
import { resolveDisplayMediaUrl } from "../utils/mediaUrl";
import { formatCurrency } from "../utils/formatCurrency";
import { useActiveUnit } from "../context/ActiveUnitContext";

function isStatusNonAktif(status) {
  const normalized = String(status ?? "aktif").trim().toLowerCase();
  return normalized !== "aktif" && normalized !== "active" && normalized !== "";
}

function formatExitSummary(summary) {
  const lines = [
    `Tagihan pembayaran belum lunas: ${summary.tagihan_pembayaran_belum_lunas || 0}`,
    `Tagihan sahriyah belum lunas: ${summary.tagihan_sahriyah_belum_lunas || 0}`,
    `Saldo Dompet: ${formatCurrency(Number(summary.saldo_rfid || 0))}`,
    `Kartu RFID terdaftar: ${summary.kartu_rfid_aktif ? "Ya" : "Tidak"}`,
    `Wali terhubung: ${summary.wali_terhubung ? "Ya" : "Belum"}`,
  ];
  return lines.join("\n");
}

function formatDateIndonesia(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTempatTanggalLahir(item) {
  const tempat = item?.tempat_lahir || "";
  const tanggal = formatDateIndonesia(item?.tanggal_lahir);
  if (tempat && tanggal) return `${tempat}, ${tanggal}`;
  return tempat || tanggal || "-";
}

function formatLimitHarian(value) {
  if (value === null || value === undefined) return "Tanpa limit harian";
  return formatCurrency(Number(value || 0));
}

function SantriPage() {
  const { activeUnitId, activeUnit, allUnitsAllowed } = useActiveUnit();
  const [santri, setSantri] = useState([]);
  const [kelas, setKelas] = useState([]);
  const [identityCandidates, setIdentityCandidates] = useState([]);
  const [editId, setEditId] = useState(null);
  const [originalStatus, setOriginalStatus] = useState("aktif");
  const [importOpen, setImportOpen] = useState(false);
  const [detailSantri, setDetailSantri] = useState(null);
  const [tableSearch, setTableSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState(null);
  const [form, setForm] = useState({
    nis: "",
    nama: "",
    tempat_lahir: "",
    tanggal_lahir: "",
    jenis_kelamin: "",
    tanggal_masuk_pesantren: "",
    uid_rfid: "",
    alamat: "",
    orang_tua: "",
    nomor_hp_ortu: "",
    kelas_id: "",
    kamar: "",
    foto: "",
    status: "aktif",
    limit_harian: "0",
    tanpa_limit_harian: false,
    existing_santri_id: "",
  });

  const getSantri = async () => {
    try {
      const response = await api.get("/santri", {
        params: activeUnitId ? { unit_id: activeUnitId } : (allUnitsAllowed ? { scope: "all" } : {}),
      });
      setSantri(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const getKelas = async () => {
    try {
      const response = await api.get("/kelas", {
        params: activeUnitId ? { unit_id: activeUnitId } : (allUnitsAllowed ? { scope: "all" } : {}),
      });
      setKelas(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const getIdentityCandidates = async () => {
    if (!activeUnitId) {
      setIdentityCandidates([]);
      return;
    }
    try {
      const response = await api.get("/santri/identity-candidates", {
        params: { unit_id: activeUnitId },
      });
      setIdentityCandidates(response.data.data || []);
    } catch {
      setIdentityCandidates([]);
    }
  };

  useEffect(() => {
    // Loading workspace data synchronizes this page with the selected external API scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    getSantri();
    getKelas();
    getIdentityCandidates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUnitId]);

  const filteredSantri = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return santri;
    return santri.filter((item) =>
      [
        item.nis,
        item.nama,
        item.tempat_lahir,
        item.tanggal_lahir,
        item.jenis_kelamin,
        item.tanggal_masuk_pesantren,
        item.alamat,
        item.nama_kelas,
        item.kamar,
        item.orang_tua,
        item.nomor_hp_ortu,
        item.uid_rfid,
        ...(item.memberships || []).flatMap((membership) => [
          membership.unit_nama,
          membership.unit_kode,
          membership.nama_kelas,
          membership.unit_student_number,
        ]),
      ]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [santri, tableSearch]);

  const { page, setPage, paginatedItems, totalItems, pageSize } = useClientPagination(filteredSantri);

  useEffect(() => {
    setPage(1);
  }, [tableSearch, setPage]);

  const handleChange = (e) => {
    setSubmitMessage(null);
    setForm({
      ...form,
      [e.target.name]: e.target.name === "uid_rfid" ? canonicalAttendanceUid(e.target.value) : e.target.value,
    });
  };

  const buildPayload = () => ({
    ...form,
    unit_id: activeUnitId || undefined,
    limit_harian: form.tanpa_limit_harian ? null : Number(form.limit_harian || 0),
    tanpa_limit_harian: undefined,
  });

  const addSantri = async () => {
    if (isSubmitting) return;

    if (!activeUnitId) {
      setSubmitMessage({ type: "error", text: "Pilih satu Unit Pendidikan sebelum menambah santri." });
      return;
    }
    if (!form.existing_santri_id && (!form.nis.trim() || !form.nama.trim())) {
      setSubmitMessage({ type: "error", text: "NIS dan Nama Lengkap wajib diisi." });
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitMessage(null);
      const response = await api.post("/santri", buildPayload());
      resetForm();
      await Promise.all([getSantri(), getIdentityCandidates()]);
      const membershipUnit = response.data?.membership?.unit_id;
      setSubmitMessage({
        type: "success",
        text: `Santri berhasil ditambahkan ke ${activeUnit?.nama || `unit ${membershipUnit || activeUnitId}`}.`,
      });
    } catch (err) {
      console.error(err);
      setSubmitMessage({
        type: "error",
        text: err.response?.data?.error || err.response?.data?.message || "Gagal menambah santri. Silakan coba lagi.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const editSantri = (item) => {
    setEditId(item.id);
    setOriginalStatus(item.status || "aktif");
    setForm({
      nis: item.nis || "",
      nama: item.nama || "",
      tempat_lahir: item.tempat_lahir || "",
      tanggal_lahir: item.tanggal_lahir ? String(item.tanggal_lahir).slice(0, 10) : "",
      jenis_kelamin: item.jenis_kelamin || "",
      tanggal_masuk_pesantren: item.tanggal_masuk_pesantren
        ? String(item.tanggal_masuk_pesantren).slice(0, 10)
        : "",
      uid_rfid: item.uid_rfid || "",
      alamat: item.alamat || "",
      orang_tua: item.orang_tua || "",
      nomor_hp_ortu: item.nomor_hp_ortu || "",
      kelas_id: item.kelas_id || "",
      kamar: item.kamar || "",
      foto: item.foto || "",
      status: item.status || "aktif",
      limit_harian: item.limit_harian === null || item.limit_harian === undefined
        ? ""
        : String(item.limit_harian),
      tanpa_limit_harian: item.limit_harian === null || item.limit_harian === undefined,
      existing_santri_id: "",
    });
  };

  const updateSantri = async () => {
    try {
      const wasAktif = !isStatusNonAktif(originalStatus);
      const willNonAktif = isStatusNonAktif(form.status);

      if (wasAktif && willNonAktif) {
      const summaryRes = await api.get(`/santri/${editId}/exit-summary`, {
        params: { unit_id: activeUnitId },
      });
        const summary = summaryRes.data.data;
        const ok = window.confirm(
          `Santri akan diubah menjadi nonaktif.\n\nRingkasan:\n${formatExitSummary(summary)}\n\nLanjutkan?`,
        );
        if (!ok) return;
      }

      const response = await api.put(`/santri/${editId}`, buildPayload());
      if (response.data.exit_summary) {
        alert(
          `Santri diperbarui.\n\nRingkasan keluar:\n${formatExitSummary(response.data.exit_summary)}`,
        );
      } else {
        alert("Santri updated");
      }
      resetForm();
      getSantri();
      setEditId(null);
      setOriginalStatus("aktif");
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal memperbarui santri");
    }
  };

  const deleteSantri = async (id) => {
    try {
      await api.delete(`/santri/${id}`, { params: { unit_id: activeUnitId } });
      getSantri();
    } catch (err) {
      console.error(err);
    }
  };

  const resetForm = () => {
    setForm({
      nis: "",
      nama: "",
      tempat_lahir: "",
      tanggal_lahir: "",
      jenis_kelamin: "",
      tanggal_masuk_pesantren: "",
      uid_rfid: "",
      alamat: "",
      orang_tua: "",
      nomor_hp_ortu: "",
      kelas_id: "",
      kamar: "",
      foto: "",
      status: "aktif",
      limit_harian: "0",
      tanpa_limit_harian: false,
      existing_santri_id: "",
    });
    setEditId(null);
    setOriginalStatus("aktif");
  };

  const handleExport = () => {
    const rows = santri.map((item) => ({
      NIS: item.nis,
      Nama: item.nama,
      TempatLahir: item.tempat_lahir,
      TanggalLahir: item.tanggal_lahir,
      JenisKelamin: item.jenis_kelamin,
      TanggalMasukPesantren: item.tanggal_masuk_pesantren,
      Kelas: item.nama_kelas,
      Unit: (item.memberships || []).map((membership) => membership.unit_nama).join(", "),
      Kamar: item.kamar,
      OrangTua: item.orang_tua,
      NomorHPWali: item.nomor_hp_ortu,
      RFID: item.uid_rfid,
      Saldo: item.saldo,
      LimitJajanHarian: item.limit_harian === null || item.limit_harian === undefined
        ? "Tanpa limit"
        : item.limit_harian,
      Alamat: item.alamat,
    }));

    exportExcel(rows, "Santri");
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get("/santri/import/template", {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "template_import_santri.xlsx");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal unduh template");
    }
  };

  return (
    <AppShell title="Data Santri" breadcrumb="Master Data / Santri">
      <div style={{ marginBottom: 12, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
        Workspace: {activeUnit?.nama || (allUnitsAllowed ? "Semua Unit" : "Unit belum dipilih")}
        {!activeUnitId && allUnitsAllowed ? " — pilih satu unit untuk menambah, mengubah, menghapus, atau import." : ""}
      </div>
      <Card padding="md" shadow="card" border={false} radius="xl">
        <FormSection title={editId ? "Edit Santri" : "Tambah Santri"}>
          <FormSection title="Data Santri">
            <FormGrid>
              {!editId ? (
                <FormField
                  label="Hubungkan Identitas Existing (Opsional)"
                  htmlFor="santri-existing-identity"
                  fullWidth
                  helper="Pilih identitas yang sudah ada agar tidak membuat santri duplikat. Membership unit baru akan dibuat pada workspace aktif."
                >
                  <Select
                    id="santri-existing-identity"
                    name="existing_santri_id"
                    value={form.existing_santri_id}
                    onChange={handleChange}
                  >
                    <option value="">Buat identitas santri baru</option>
                    {identityCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.nama} — {candidate.nis || "tanpa NIS"}
                        {candidate.unit_names ? ` (${candidate.unit_names})` : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label="NIS" htmlFor="santri-nis" required>
                <Input id="santri-nis" type="text" name="nis" value={form.nis} onChange={handleChange} />
              </FormField>
              <FormField label="Nama Lengkap" htmlFor="santri-nama" required>
                <Input id="santri-nama" type="text" name="nama" value={form.nama} onChange={handleChange} />
              </FormField>
              <FormField label="Tempat Lahir" htmlFor="santri-tempat-lahir">
                <Input
                  id="santri-tempat-lahir"
                  type="text"
                  name="tempat_lahir"
                  value={form.tempat_lahir}
                  onChange={handleChange}
                />
              </FormField>
              <FormField label="Tanggal Lahir" htmlFor="santri-tanggal-lahir">
                <Input
                  id="santri-tanggal-lahir"
                  type="date"
                  name="tanggal_lahir"
                  value={form.tanggal_lahir}
                  onChange={handleChange}
                />
              </FormField>
              <FormField label="Jenis Kelamin" htmlFor="santri-jenis-kelamin">
                <Select
                  id="santri-jenis-kelamin"
                  name="jenis_kelamin"
                  value={form.jenis_kelamin}
                  onChange={handleChange}
                >
                  <option value="">Pilih Jenis Kelamin</option>
                  <option value="Laki-laki">Laki-laki</option>
                  <option value="Perempuan">Perempuan</option>
                </Select>
              </FormField>
              <FormField label="Tanggal Masuk Pesantren" htmlFor="santri-tanggal-masuk">
                <Input
                  id="santri-tanggal-masuk"
                  type="date"
                  name="tanggal_masuk_pesantren"
                  value={form.tanggal_masuk_pesantren}
                  onChange={handleChange}
                />
              </FormField>
              <FormField label="Kelas" htmlFor="santri-kelas">
                <Select id="santri-kelas" name="kelas_id" value={form.kelas_id} onChange={handleChange}>
                  <option value="">Pilih Kelas</option>
                  {kelas.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.nama_kelas}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Kamar / Asrama" htmlFor="santri-kamar" helper="Alamat internal santri di pesantren.">
                <Input
                  id="santri-kamar"
                  type="text"
                  name="kamar"
                  value={form.kamar}
                  onChange={handleChange}
                  placeholder="Contoh: A-12 / Asrama Putra"
                />
              </FormField>
              <FormField label="Status" htmlFor="santri-status">
                <Select id="santri-status" name="status" value={form.status} onChange={handleChange}>
                  <option value="aktif">Aktif</option>
                  <option value="nonaktif">Nonaktif</option>
                  <option value="lulus">Lulus</option>
                  <option value="keluar">Keluar</option>
                </Select>
              </FormField>
            </FormGrid>
          </FormSection>

          {editId ? <SantriOperationalChecklist santriId={editId} /> : null}

          <FormSection title="Pengaturan RFID">
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>
              Limit harian adalah batas maksimal transaksi RFID santri per hari. Isi 0 jika santri tidak boleh jajan melalui RFID.
            </p>
            <FormGrid>
              <FormField label="UID RFID / Kartu RFID" htmlFor="santri-rfid">
                <Input id="santri-rfid" type="text" name="uid_rfid" value={form.uid_rfid} onChange={handleChange} />
              </FormField>
              <FormField label="Saldo Dompet" htmlFor="santri-saldo-rfid" helper="Saldo dikelola lewat menu topup Dompet.">
                <Input
                  id="santri-saldo-rfid"
                  type="text"
                  value={editId ? formatCurrency(Number(santri.find((item) => item.id === editId)?.saldo || 0)) : "Akan aktif setelah santri dibuat"}
                  readOnly
                />
              </FormField>
              <FormField
                label="Limit Jajan Harian"
                htmlFor="santri-limit-harian"
                helper={form.tanpa_limit_harian ? "Santri tetap wajib punya saldo cukup, tapi tidak dibatasi limit harian." : "Nominal maksimal transaksi RFID per hari."}
              >
                <Input
                  id="santri-limit-harian"
                  type="number"
                  min="0"
                  step="1000"
                  name="limit_harian"
                  value={form.limit_harian}
                  onChange={handleChange}
                  disabled={form.tanpa_limit_harian}
                />
              </FormField>
              <FormField label="Tanpa limit harian" htmlFor="santri-tanpa-limit">
                <label style={checkboxRowStyle}>
                  <input
                    id="santri-tanpa-limit"
                    type="checkbox"
                    checked={form.tanpa_limit_harian}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        tanpa_limit_harian: e.target.checked,
                        limit_harian: e.target.checked ? "" : prev.limit_harian || "0",
                      }))
                    }
                  />
                  <span>Aktifkan jika santri boleh transaksi tanpa batas harian.</span>
                </label>
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Data Wali">
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>
              Nomor HP ini otomatis menjadi akun login aplikasi wali.
            </p>
            <FormGrid>
              <FormField label="Nama Wali" htmlFor="santri-ortu">
                <Input id="santri-ortu" type="text" name="orang_tua" value={form.orang_tua} onChange={handleChange} />
              </FormField>
              <FormField label="Nomor HP Wali" htmlFor="santri-hp-ortu">
                <Input id="santri-hp-ortu" type="text" name="nomor_hp_ortu" value={form.nomor_hp_ortu} onChange={handleChange} />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Data Administrasi">
            <FormGrid>
              <FormField label="Alamat Lengkap" htmlFor="santri-alamat" fullWidth>
                <Textarea
                  id="santri-alamat"
                  name="alamat"
                  rows={3}
                  value={form.alamat}
                  onChange={handleChange}
                />
              </FormField>
              <FormField label="Upload Foto" htmlFor="santri-foto" fullWidth>
                <ImageUploadField
                  id="santri-foto"
                  label="Foto Santri"
                  value={form.foto}
                  onChange={(url) => setForm((prev) => ({ ...prev, foto: url }))}
                  accept="image/*"
                  pickLabel="Pilih Foto"
                  previewHeight={120}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormActionBar className="form-action-bar-v3--compact">
            <Button
              variant="primary"
              onClick={editId ? updateSantri : addSantri}
              disabled={!activeUnitId}
              loading={!editId && isSubmitting}
            >
              {editId ? "Update" : isSubmitting ? "Menyimpan..." : "Tambah"}
            </Button>
            {!activeUnitId ? (
              <span role="status" style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                Pilih satu unit untuk menambah santri.
              </span>
            ) : null}
            {submitMessage ? (
              <span
                role={submitMessage.type === "error" ? "alert" : "status"}
                aria-live="polite"
                style={{
                  color: submitMessage.type === "error" ? "var(--danger)" : "var(--success)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {submitMessage.text}
              </span>
            ) : null}
          </FormActionBar>
        </FormSection>
      </Card>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Daftar Santri"
          subtitle="Kelola data santri pesantren"
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {filteredSantri.length} data
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Cari NIS, nama, kelas, wali, RFID..."
              />
            }
            actions={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="secondary" onClick={handleDownloadTemplate}>
                  Download Template
                </Button>
                <Button variant="primary" onClick={() => setImportOpen(true)} disabled={!activeUnitId}>
                  Import Excel
                </Button>
                <Button variant="success" onClick={handleExport}>
                  Export Excel
                </Button>
              </div>
            }
          />

          {filteredSantri.length === 0 ? (
            <EmptyState
              title={santri.length === 0 ? "Belum ada data" : "Tidak ada hasil pencarian"}
              description={
                santri.length === 0
                  ? "Tambahkan data pertama untuk memulai."
                  : "Coba kata kunci lain atau hapus filter pencarian."
              }
            />
          ) : (
            <>
              <TableScroll stickyScrollbar>
                <Table translate="no">
                  <thead>
                    <tr>
                      <th>Foto</th>
                      <th>NIS</th>
                      <th>Nama</th>
                      <th>TTL</th>
                      <th>JK</th>
                      <th>Tanggal Masuk</th>
                      <th>Kelas</th>
                      <th>Unit</th>
                      <th>Kamar / Asrama</th>
                      <th>Wali</th>
                      <th translate="no">Nomor HP Wali</th>
                      <th>RFID</th>
                      <th>Saldo</th>
                      <th>Status</th>
                      <th className="table-v3__cell--actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => {
                      const fotoSrc = resolveDisplayMediaUrl(item.foto);
                      return (
                      <tr key={item.id}>
                        <td>
                          {fotoSrc ? (
                            <img
                              src={fotoSrc}
                              alt="foto"
                              width="40"
                              height="40"
                              style={{ borderRadius: "8px", objectFit: "cover" }}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{item.nis}</td>
                        <td className="table-v3__cell--strong">{item.nama}</td>
                        <td>{formatTempatTanggalLahir(item)}</td>
                        <td>{item.jenis_kelamin || "-"}</td>
                        <td>{formatDateIndonesia(item.tanggal_masuk_pesantren) || "-"}</td>
                        <td>{item.nama_kelas || "—"}</td>
                        <td>{(item.memberships || []).map((membership) => membership.unit_nama).join(", ") || "—"}</td>
                        <td>{item.kamar || "—"}</td>
                        <td translate="no">{item.orang_tua || "—"}</td>
                        <td translate="no">{item.nomor_hp_ortu || "—"}</td>
                        <td className="table-v3__cell--mono">{item.uid_rfid || "—"}</td>
                        <td>Rp {Number(item.saldo || 0).toLocaleString()}</td>
                        <td>{item.status || "aktif"}</td>
                        <td className="table-v3__cell--actions">
                          <TableActions
                            items={[
                              { type: "detail", onClick: () => setDetailSantri(item) },
                              ...(activeUnitId ? [
                                { type: "edit", onClick: () => editSantri(item) },
                                { type: "delete", onClick: () => deleteSantri(item.id) },
                              ] : []),
                            ]}
                          />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableScroll>
              <TablePagination
                page={page}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={setPage}
              />
            </>
          )}
        </DataTableCard>
      </div>

      <SantriImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={getSantri}
        unitId={activeUnitId}
        unitName={activeUnit?.nama}
      />

      <Modal
        open={Boolean(detailSantri)}
        title="Detail Santri"
        onClose={() => setDetailSantri(null)}
        width={680}
      >
        {detailSantri ? (
          <div style={detailGridStyle}>
            <DetailItem label="Nama Lengkap" value={detailSantri.nama || "-"} />
            <DetailItem label="NIS" value={detailSantri.nis || "-"} />
            <DetailItem label="Tempat, Tanggal Lahir" value={formatTempatTanggalLahir(detailSantri)} />
            <DetailItem label="Jenis Kelamin" value={detailSantri.jenis_kelamin || "-"} />
            <DetailItem
              label="Tanggal Masuk Pesantren"
              value={formatDateIndonesia(detailSantri.tanggal_masuk_pesantren) || "-"}
            />
            <DetailItem label="Kelas" value={detailSantri.nama_kelas || "-"} />
            <DetailItem
              label="Unit Pendidikan"
              value={(detailSantri.memberships || []).map((membership) => membership.unit_nama).join(", ") || "-"}
            />
            <DetailItem label="Kamar / Asrama" value={detailSantri.kamar || "-"} />
            <DetailItem label="Wali" value={detailSantri.orang_tua || "-"} translate="no" />
            <DetailItem label="Nomor HP Wali" value={detailSantri.nomor_hp_ortu || "-"} translate="no" />
            <DetailItem label="UID RFID" value={detailSantri.uid_rfid || "-"} />
            <DetailItem label="Saldo Dompet" value={formatCurrency(Number(detailSantri.saldo || 0))} />
            <DetailItem label="Limit Jajan Harian" value={formatLimitHarian(detailSantri.limit_harian)} />
            <DetailItem label="Status" value={detailSantri.status || "aktif"} />
            <DetailItem label="Alamat Lengkap" value={detailSantri.alamat || "-"} fullWidth />
          </div>
        ) : null}
      </Modal>
    </AppShell>
  );
}

function DetailItem({ label, value, fullWidth = false, translate = undefined }) {
  return (
    <div style={{ ...detailItemStyle, ...(fullWidth ? { gridColumn: "1 / -1" } : {}) }}>
      <span style={detailLabelStyle}>{label}</span>
      <strong style={detailValueStyle} translate={translate}>{value}</strong>
    </div>
  );
}

const detailGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const detailItemStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "12px 14px",
  background: "var(--surface-muted)",
};

const detailLabelStyle = {
  display: "block",
  marginBottom: 5,
  fontSize: 12,
  color: "var(--text-secondary)",
  fontWeight: 700,
};

const detailValueStyle = {
  color: "var(--text-primary)",
  whiteSpace: "pre-wrap",
};

const checkboxRowStyle = {
  minHeight: 42,
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "var(--text-primary)",
  fontWeight: 600,
};

export default SantriPage;
