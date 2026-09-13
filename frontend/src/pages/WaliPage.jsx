import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaInfoCircle, FaKey } from "react-icons/fa";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
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
  FormGrid,
  FormActionBar,
  FormSection,
} from "../components/ui/form";
import { exportExcel } from "../utils/exportExcel";
import { useActiveUnit } from "../context/ActiveUnitContext";

const DEFAULT_PIN_DISPLAY = "456789";

function aggregateWaliAccounts(rows) {
  const map = new Map();

  for (const row of rows) {
    const hp = String(row.nomor_hp || "").trim();
    const key = hp || `__no_hp__${row.id}`;

    if (!map.has(key)) {
      map.set(key, {
        key,
        nomor_hp: hp || null,
        nama: row.nama || "—",
        waliRowId: row.id,
        anak: [],
        anakIds: new Set(),
      });
    }

    const account = map.get(key);
    if (row.nama && (!account.nama || account.nama === "—")) {
      account.nama = row.nama;
    }
    if (row.nama_santri && !account.anakIds.has(String(row.santri_id))) {
      account.anakIds.add(String(row.santri_id));
      account.anak.push({
        santri_id: row.santri_id,
        nama: row.nama_santri,
        wali_row_id: row.id,
      });
    }
    if (!account.waliRowId) {
      account.waliRowId = row.id;
    }
  }

  return Array.from(map.values()).map((account) => {
    account.jumlah_anak = account.anak.length;
    account.anak_label = account.anak.map((a) => a.nama).join(", ") || "—";
    delete account.anakIds;
    return account;
  });
}

function WaliPage() {
  const navigate = useNavigate();
  const { activeUnitId, activeUnit, allUnitsAllowed } = useActiveUnit();
  const requestIdRef = useRef(0);
  const savingRef = useRef(false);
  const [wali, setWali] = useState([]);
  const [santri, setSantri] = useState([]);
  const [editId, setEditId] = useState(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nama: "",
    nomor_hp: "",
    alamat: "",
    santri_id: "",
  });

  const loadScopedData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setWali([]);
    setSantri([]);
    setLoadError("");
    if (!activeUnitId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = { unit_id: activeUnitId };
      const [waliResponse, santriResponse] = await Promise.all([
        api.get("/wali", { params }),
        api.get("/santri", { params }),
      ]);
      if (requestIdRef.current !== requestId) return;
      setWali(waliResponse.data.data || []);
      setSantri(santriResponse.data.data || []);
    } catch (err) {
      console.error(err);
      if (requestIdRef.current === requestId) {
        setLoadError(err.response?.data?.error || "Gagal memuat data wali unit");
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [activeUnitId]);

  useEffect(() => {
    loadScopedData();
    return () => { requestIdRef.current += 1; };
  }, [loadScopedData]);

  const resetPin = async (waliRowId, nama) => {
    if (!activeUnitId) return alert("Pilih satu unit aktif terlebih dahulu");
    if (!window.confirm(`Reset PIN ${nama} ke ${DEFAULT_PIN_DISPLAY}?`)) return;

    try {
      await api.put(`/wali/${waliRowId}/reset-pin`, { unit_id: activeUnitId });
      alert(
        `PIN ${nama} berhasil direset ke ${DEFAULT_PIN_DISPLAY}.\nWali wajib ganti PIN saat login berikutnya.`,
      );
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal reset PIN");
    }
  };
  const workspaceLabel = activeUnitId
    ? activeUnit?.nama || activeUnit?.kode || "Unit aktif"
    : allUnitsAllowed ? "Semua Unit - pilih satu unit" : "Unit belum dipilih";

  const accounts = useMemo(() => aggregateWaliAccounts(wali), [wali]);

  const filteredAccounts = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((item) =>
      [item.nama, item.nomor_hp, item.anak_label]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [accounts, tableSearch]);

  const { page, setPage, paginatedItems, totalItems, pageSize } =
    useClientPagination(filteredAccounts);

  useEffect(() => {
    setPage(1);
  }, [tableSearch, setPage]);

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const resetForm = () => {
    setForm({
      nama: "",
      nomor_hp: "",
      alamat: "",
      santri_id: "",
    });
    setEditId(null);
  };

  const createWali = async () => {
    if (!activeUnitId) return alert("Pilih satu unit aktif terlebih dahulu");
    if (savingRef.current) return;
    savingRef.current = true;
    const submittedRequestId = requestIdRef.current;
    setSaving(true);
    try {
      await api.post("/wali", { ...form, unit_id: activeUnitId });
      alert("Akun wali manual berhasil dibuat");
      resetForm();
      setShowManualForm(false);
      if (requestIdRef.current === submittedRequestId) {
        await loadScopedData();
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal membuat akun wali");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const editAccount = (account) => {
    const source = wali.find((row) => row.id === account.waliRowId) || wali.find(
      (row) => row.nomor_hp === account.nomor_hp,
    );
    if (!source) return;

    setEditId(source.id);
    setShowManualForm(true);
    setForm({
      nama: source.nama || "",
      nomor_hp: source.nomor_hp || "",
      alamat: source.alamat || "",
      santri_id: source.santri_id || "",
    });
  };

  const updateWali = async () => {
    if (!activeUnitId) return alert("Pilih satu unit aktif terlebih dahulu");
    if (savingRef.current) return;
    savingRef.current = true;
    const submittedRequestId = requestIdRef.current;
    setSaving(true);
    try {
      await api.put(`/wali/${editId}`, { ...form, unit_id: activeUnitId });
      alert("Akun wali berhasil diperbarui");
      resetForm();
      setShowManualForm(false);
      if (requestIdRef.current === submittedRequestId) {
        await loadScopedData();
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal memperbarui akun wali");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleExport = () => {
    const rows = accounts.map((item) => ({
      NamaWali: item.nama,
      NomorHP: item.nomor_hp,
      JumlahAnak: item.jumlah_anak,
      AnakTerhubung: item.anak_label,
    }));

    exportExcel(rows, "AkunWali");
  };

  return (
    <AppShell
      title="Manajemen Akun Wali"
      breadcrumb="Master Data / Manajemen Akun Wali"
    >
      <div style={infoBannerWrapStyle}>
        <div style={infoBannerInnerStyle}>
          <div style={infoIconWrapStyle} aria-hidden>
            <FaInfoCircle style={{ fontSize: 20, color: "var(--primary)" }} />
          </div>
          <div>
            <p style={infoTitleStyle}>Akun wali tidak perlu dibuat manual.</p>
            <p style={infoTextStyle}>
              Saat data santri diisi dengan Nama Wali dan Nomor HP Wali, KlikPesantren
              akan otomatis membuat akun login aplikasi wali.
            </p>
          </div>
        </div>
      </div>

      <div style={{ marginTop: "var(--space-4)", fontSize: 13, color: activeUnitId ? "var(--text-secondary)" : "var(--danger)" }}>
        Workspace: <strong>{workspaceLabel}</strong>
      </div>
      {loadError ? <div className="form-error-v3" style={{ marginTop: "var(--space-3)" }}>{loadError}</div> : null}

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Daftar Akun Wali"
          subtitle="Akun wali otomatis dibuat dari data santri dan import Excel."
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {loading ? "Memuat..." : `${filteredAccounts.length} akun`}
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Cari nama wali, nomor HP, nama anak..."
              />
            }
            actions={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button
                  variant="secondary"
                  disabled={!activeUnitId || loading || saving}
                  onClick={() => {
                    resetForm();
                    setShowManualForm((v) => !v);
                  }}
                >
                  {showManualForm ? "Tutup Form Manual" : "Tambah Akun Wali Manual"}
                </Button>
                <Button variant="success" onClick={handleExport} disabled={!activeUnitId || loading}>
                  Export Excel
                </Button>
              </div>
            }
          />

          {showManualForm ? (
            <Card padding="md" shadow="none" border radius="lg" style={{ marginBottom: 16 }}>
              <FormSection title={editId ? "Edit Akun Wali Manual" : "Tambah Akun Wali Manual"}>
                <p style={manualWarningStyle}>
                  Disarankan membuat akun wali melalui data santri. Form ini untuk kasus khusus.
                </p>
                <FormGrid>
                  <FormField label="Nama Wali" htmlFor="wali-nama" required>
                    <Input
                      id="wali-nama"
                      type="text"
                      name="nama"
                      value={form.nama}
                      onChange={handleChange}
                    />
                  </FormField>
                  <FormField label="Nomor HP" htmlFor="wali-hp" required>
                    <Input
                      id="wali-hp"
                      type="text"
                      name="nomor_hp"
                      value={form.nomor_hp}
                      onChange={handleChange}
                    />
                  </FormField>
                  <FormField label="Alamat" htmlFor="wali-alamat" fullWidth>
                    <Input
                      id="wali-alamat"
                      type="text"
                      name="alamat"
                      value={form.alamat}
                      onChange={handleChange}
                    />
                  </FormField>
                  <FormField label="Santri Terhubung" htmlFor="wali-santri" required>
                    <Select
                      id="wali-santri"
                      name="santri_id"
                      value={form.santri_id}
                      onChange={handleChange}
                    >
                      <option value="">Pilih Santri</option>
                      {santri.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nama}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </FormGrid>
                <FormActionBar className="form-action-bar-v3--compact">
                  <Button variant="primary" onClick={editId ? updateWali : createWali} disabled={!activeUnitId || saving}>
                    {editId ? "Simpan Perubahan" : "Tambah Akun Wali Manual"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!activeUnitId || loading || saving}
                  onClick={() => {
                      resetForm();
                      setShowManualForm(false);
                    }}
                  >
                    Batal
                  </Button>
                </FormActionBar>
              </FormSection>
            </Card>
          ) : null}

          {filteredAccounts.length === 0 ? (
            <EmptyState
              title={
                !activeUnitId
                  ? "Pilih satu unit aktif"
                  : loading
                    ? "Memuat akun wali..."
                    : accounts.length === 0
                      ? "Belum ada akun wali"
                      : "Tidak ada hasil pencarian"
              }
              description={
                !activeUnitId
                  ? "Daftar wali tidak dimuat tanpa scope unit yang valid."
                  : loading
                    ? "Data wali dan santri sedang dimuat untuk unit aktif."
                    : accounts.length === 0
                      ? "Tambahkan data santri beserta Nama Wali dan Nomor HP Wali, maka akun wali akan dibuat otomatis."
                      : "Coba kata kunci lain atau hapus filter pencarian."
              }
              action={
                activeUnitId && !loading && accounts.length === 0 ? (
                  <Button variant="primary" onClick={() => navigate("/santri")}>
                    Tambah Santri
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th>Nama Wali</th>
                      <th>Nomor HP</th>
                      <th>Jumlah Anak</th>
                      <th>Anak Terhubung</th>
                      <th>Status Akun</th>
                      <th>Harus Ganti PIN</th>
                      <th className="table-v3__cell--actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => (
                      <tr key={item.key}>
                        <td className="table-v3__cell--strong">{item.nama}</td>
                        <td>{item.nomor_hp || "—"}</td>
                        <td>{item.jumlah_anak}</td>
                        <td style={{ maxWidth: 220 }}>{item.anak_label}</td>
                        <td>
                          <Badge variant="neutral" size="sm">
                            —
                          </Badge>
                        </td>
                        <td>
                          <Badge variant="neutral" size="sm">
                            —
                          </Badge>
                        </td>
                        <td className="table-v3__cell--actions">
                          <TableActions
                            items={[
                              {
                                type: "edit",
                                onClick: () => editAccount(item),
                                title: "Edit",
                              },
                              ...(item.nomor_hp
                                ? [
                                    {
                                      type: "custom",
                                      icon: FaKey,
                                      title: "Reset PIN",
                                      onClick: () =>
                                        resetPin(item.waliRowId, item.nama),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
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
    </AppShell>
  );
}

const infoBannerWrapStyle = {
  background: "var(--success-subtle)",
  border: "1px solid rgba(22, 163, 74, 0.18)",
  borderRadius: "var(--radius-xl)",
  padding: "var(--space-5) var(--space-6)",
  boxShadow: "var(--shadow-card)",
};

const infoBannerInnerStyle = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
};

const infoIconWrapStyle = {
  flexShrink: 0,
  width: 40,
  height: 40,
  borderRadius: "var(--radius-lg)",
  background: "rgba(255, 255, 255, 0.7)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const infoTitleStyle = {
  margin: 0,
  fontSize: 14,
  fontWeight: 700,
  color: "var(--text-primary)",
};

const infoTextStyle = {
  margin: "6px 0 0",
  fontSize: 13,
  color: "var(--text-secondary)",
  lineHeight: 1.55,
};

const manualWarningStyle = {
  margin: "0 0 14px",
  padding: "10px 12px",
  borderRadius: 8,
  background: "var(--warning-subtle)",
  color: "var(--warning)",
  fontSize: 13,
  lineHeight: 1.5,
};

export default WaliPage;
