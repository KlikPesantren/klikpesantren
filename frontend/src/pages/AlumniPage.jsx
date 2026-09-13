import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import SearchInput from "../components/ui/SearchInput";
import { Table, TableScroll } from "../components/ui/table";
import { FormField, Input, Select, Textarea, FormGrid, FormSection, FormActionBar } from "../components/ui/form";
import AlumniImportModal from "../components/alumni/AlumniImportModal";
import { useActiveUnit } from "../context/ActiveUnitContext";

const EMPTY = {
  nama: "", nis: "", jenis_kelamin: "", tahun_masuk: "", tahun_lulus: "",
  angkatan: "", status_kelulusan: "lulus", kelas_terakhir: "", kontak: "",
  alamat: "", pekerjaan: "", catatan: "",
};

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function AlumniPage() {
  const { activeUnitId, activeUnit, allUnitsAllowed } = useActiveUnit();
  const [list, setList] = useState([]);
  const [years, setYears] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [editId, setEditId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeUnitId) {
      setList([]);
      setYears([]);
      return;
    }
    setLoading(true);
    try {
      const response = await api.get("/alumni", {
        params: { unit_id: activeUnitId, search: search.trim() || undefined, tahun_lulus: yearFilter || undefined },
      });
      setList(response.data.data || []);
      setYears(response.data.meta?.available_years || []);
    } catch (error) {
      alert(error.response?.data?.error || "Gagal memuat data alumni");
    } finally {
      setLoading(false);
    }
  }, [activeUnitId, search, yearFilter]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setForm(EMPTY);
      setEditId(null);
      setYearFilter("");
      setImportOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeUnitId]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const resetForm = () => { setForm(EMPTY); setEditId(null); };

  const editAlumni = (item) => {
    setEditId(item.id);
    setForm(Object.fromEntries(Object.keys(EMPTY).map((key) => [key, item[key] ?? EMPTY[key]])));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!activeUnitId) return alert("Pilih satu unit aktif terlebih dahulu");
    if (!form.nama.trim()) return alert("Nama alumni wajib diisi");
    if (!form.tahun_lulus) return alert("Tahun lulus wajib diisi");
    setSaving(true);
    try {
      const body = { ...form, unit_id: activeUnitId };
      if (editId) await api.put(`/alumni/${editId}`, body);
      else await api.post("/alumni", body);
      resetForm();
      await load();
    } catch (error) {
      alert(error.response?.data?.error || "Gagal menyimpan alumni");
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = async () => {
    if (!activeUnitId) return alert("Pilih satu unit aktif terlebih dahulu");
    setDownloading("template");
    try {
      const response = await api.get("/alumni/import/template", { params: { unit_id: activeUnitId }, responseType: "blob" });
      downloadBlob(new Blob([response.data]), "template_import_alumni.xlsx");
    } catch (error) {
      alert(error.response?.data?.error || "Gagal download template Alumni");
    } finally {
      setDownloading("");
    }
  };

  const exportExcel = async () => {
    if (!activeUnitId) return alert("Pilih satu unit aktif terlebih dahulu");
    setDownloading("export");
    try {
      const response = await api.get("/alumni/export", {
        params: { unit_id: activeUnitId, search: search.trim() || undefined, tahun_lulus: yearFilter || undefined },
        responseType: "blob",
      });
      downloadBlob(new Blob([response.data]), `alumni_${activeUnit?.nama || activeUnitId}.xlsx`);
    } catch (error) {
      alert(error.response?.data?.error || "Gagal export Alumni");
    } finally {
      setDownloading("");
    }
  };

  const unitBlocked = !activeUnitId;

  return (
    <AppShell title="Data Alumni" breadcrumb="Data Utama / Alumni">
      <div style={workspaceStyle}>
        Workspace: {activeUnit?.nama || (allUnitsAllowed ? "Semua Unit" : "Unit belum dipilih")}
        {unitBlocked ? " — pilih satu unit untuk melihat, mengubah, import, atau export Alumni." : ""}
      </div>

      {!unitBlocked ? (
        <Card padding="md" shadow="card" border={false} radius="xl">
          <FormSection title={editId ? "Edit Data Alumni" : "Tambah Alumni Lama"}>
            <p style={descriptionStyle}>Data disimpan sebagai history Alumni unit <strong>{activeUnit?.nama}</strong>. Santri existing dicocokkan melalui NIS tanpa membuat identity baru.</p>
            <FormGrid>
              <FormField label="Nama Lengkap" required><Input value={form.nama} onChange={set("nama")} /></FormField>
              <FormField label="NIS"><Input value={form.nis} onChange={set("nis")} /></FormField>
              <FormField label="Jenis Kelamin"><Select value={form.jenis_kelamin} onChange={set("jenis_kelamin")}><option value="">Pilih</option><option value="Laki-laki">Laki-laki</option><option value="Perempuan">Perempuan</option></Select></FormField>
              <FormField label="Status"><Select value={form.status_kelulusan} onChange={set("status_kelulusan")}><option value="lulus">Lulus</option><option value="keluar">Keluar</option></Select></FormField>
              <FormField label="Angkatan"><Input value={form.angkatan} onChange={set("angkatan")} placeholder="Contoh: 2015" /></FormField>
              <FormField label="Tahun Masuk"><Input type="number" min="1900" max="2200" value={form.tahun_masuk} onChange={set("tahun_masuk")} /></FormField>
              <FormField label="Tahun Lulus" required><Input type="number" min="1900" max="2200" value={form.tahun_lulus} onChange={set("tahun_lulus")} /></FormField>
              <FormField label="Kelas Terakhir"><Input value={form.kelas_terakhir} onChange={set("kelas_terakhir")} /></FormField>
              <FormField label="Kontak"><Input value={form.kontak} onChange={set("kontak")} /></FormField>
              <FormField label="Pekerjaan"><Input value={form.pekerjaan} onChange={set("pekerjaan")} /></FormField>
              <FormField label="Alamat" fullWidth><Textarea rows={2} value={form.alamat} onChange={set("alamat")} /></FormField>
              <FormField label="Catatan" fullWidth><Textarea rows={2} value={form.catatan} onChange={set("catatan")} /></FormField>
            </FormGrid>
            <FormActionBar><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Menyimpan..." : editId ? "Update Alumni" : "Simpan Alumni"}</Button>{editId ? <Button variant="secondary" onClick={resetForm} disabled={saving}>Batal</Button> : null}</FormActionBar>
          </FormSection>
        </Card>
      ) : null}

      <Card padding="md" shadow="card" border={false} radius="xl">
        <div style={headerStyle}>
          <div><h2 style={{ margin: 0, fontSize: 18 }}>Daftar Alumni ({list.length})</h2><p style={subtitleStyle}>Seluruh hasil mengikuti unit, pencarian, dan tahun lulus aktif.</p></div>
          <div style={buttonGroupStyle}>
            <Button variant="secondary" onClick={downloadTemplate} disabled={unitBlocked || Boolean(downloading)}>{downloading === "template" ? "Menyiapkan..." : "Download Template"}</Button>
            <Button variant="primary" onClick={() => setImportOpen(true)} disabled={unitBlocked}>Import Excel</Button>
            <Button variant="success" onClick={exportExcel} disabled={unitBlocked || Boolean(downloading)}>{downloading === "export" ? "Mengekspor..." : "Export Excel"}</Button>
          </div>
        </div>
        <div style={filterStyle}>
          <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, NIS, kelas, kontak..." />
          <Select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} disabled={unitBlocked}>
            <option value="">Semua Tahun</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </Select>
        </div>

        {unitBlocked ? <EmptyState title="Pilih unit aktif" description="Data Alumni tidak memiliki fallback tenant-wide." />
          : loading ? <p>Memuat data alumni...</p>
            : list.length === 0 ? <EmptyState title="Belum ada alumni" description="Tambahkan manual atau import Alumni lama untuk unit aktif." />
              : (
                <TableScroll>
                  <Table><thead><tr><th>Nama</th><th>NIS</th><th>Jenis Kelamin</th><th>Tahun Masuk</th><th>Tahun Lulus</th><th>Angkatan</th><th>Status</th><th>Kelas Terakhir</th><th>Kontak</th><th>Alamat</th><th>Pekerjaan</th><th>Catatan</th><th>Aksi</th></tr></thead>
                    <tbody>{list.map((item) => <tr key={item.alumni_unit_id}><td>{item.nama}</td><td>{item.nis || "—"}</td><td>{item.jenis_kelamin || "—"}</td><td>{item.tahun_masuk || "—"}</td><td>{item.tahun_lulus || "—"}</td><td>{item.angkatan || "—"}</td><td>{item.status_kelulusan}</td><td>{item.kelas_terakhir || "—"}</td><td>{item.kontak || "—"}</td><td>{item.alamat || "—"}</td><td>{item.pekerjaan || "—"}</td><td>{item.catatan || "—"}</td><td><Button variant="secondary" size="sm" onClick={() => editAlumni(item)}>Edit</Button></td></tr>)}</tbody>
                  </Table>
                </TableScroll>
              )}
      </Card>

      <AlumniImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={load} unitId={activeUnitId} unitName={activeUnit?.nama} />
    </AppShell>
  );
}

const workspaceStyle = { marginBottom: 12, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 };
const descriptionStyle = { marginTop: 0, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 };
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, minWidth: 0 };
const subtitleStyle = { margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 };
const buttonGroupStyle = { display: "flex", flexWrap: "wrap", gap: 8, maxWidth: "100%" };
const filterStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10, margin: "16px 0", alignItems: "center", minWidth: 0 };
