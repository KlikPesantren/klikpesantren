import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import SectionHeading from "../components/ui/SectionHeading";
import Button, { actionBarStyle } from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { Table, TableScroll } from "../components/ui/table";
import { OperationalPageStyles } from "../components/shared/OperationalPageStyles";
import { exportExcel } from "../utils/exportExcel";
import { FaFilter } from "react-icons/fa";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { requireActiveUnitForWrite } from "../utils/unitScopeParams";
import { MONTH_OPTIONS_ID } from "../constants/monthOptions";

const filterPanelStyle = {
  display: "flex",
  gap: "var(--space-3)",
  flexWrap: "wrap",
  alignItems: "center",
};

function AkademikResponsiveStyles() {
  return (
    <style>{`
      .akademik-page {
        min-width: 0;
        max-width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .akademik-filter-panel.filter-bar-v3 {
        margin-bottom: 0;
      }

      .akademik-filter-panel .filter-bar-v3__fields select,
      .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
        min-width: 0;
        flex: 1 1 140px;
        max-width: 100%;
      }

      @media (max-width: 767px) {
        .akademik-filter-panel .filter-bar-v3__fields select,
        .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
          flex: 1 1 100%;
        }
      }
    `}</style>
  );
}

function HafalanPage() {
  const { activeUnitId } = useActiveUnit();
  const scopeParams = activeUnitId ? { unit_id: activeUnitId } : null;
  const [kelas, setKelas] = useState([]);
  const [kelasId, setKelasId] = useState("");
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [santri, setSantri] = useState([]);
  const [santriLoading, setSantriLoading] = useState(false);
  const [santriError, setSantriError] = useState("");
  const studentRequestId = useRef(0);
  const hafalanRequestId = useRef(0);
  const kelasRequestId = useRef(0);
  const [hafalan, setHafalan] = useState({});
  const [dirtyKeys, setDirtyKeys] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const getHafalan = async (b, t) => {
    const requestId = ++hafalanRequestId.current;
    if (!scopeParams) { setHafalan({}); return; }
    try {
      const response = await api.get("/hafalan", { params: { ...scopeParams, bulan: b, tahun: t } });
      const data = {};
      response.data.data.forEach((h) => {
        if (!h.pekan || !h.santri_id) return;
        const recBulan = parseInt(String(h.bulan), 10);
        const recTahun = parseInt(String(h.tahun), 10);
        if (isNaN(recBulan) || isNaN(recTahun)) return;
        const key = `${h.pekan}-${h.santri_id}-${recBulan}-${recTahun}`;
        data[key] = {
          kitab: h.kitab || "",
          awal: h.awal || "",
          akhir: h.akhir || "",
          catatan: h.catatan || "",
        };
      });
      if (hafalanRequestId.current === requestId) setHafalan(data);
    } catch (err) {
      console.error(err);
    }
  };

  const pekanList = [1, 2, 3, 4, 5];

  const getKelas = async () => {
    const requestId = ++kelasRequestId.current;
    if (!scopeParams) { setKelas([]); return; }
    try {
      const response = await api.get("/kelas", { params: scopeParams });
      if (kelasRequestId.current === requestId) setKelas(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const getSantri = async (id) => {
    const requestId = ++studentRequestId.current;
    setSantri([]);
    setSantriError("");
    if (!id || !scopeParams) {
      setSantriLoading(false);
      return;
    }

    try {
      setSantriLoading(true);
      const response = await api.get("/hafalan/students", {
        params: { ...scopeParams, kelas_id: id },
      });
      if (studentRequestId.current === requestId) {
        setSantri(response.data.data || []);
      }
    } catch (err) {
      console.error(err);
      if (studentRequestId.current === requestId) {
        setSantriError(err.response?.data?.error || "Gagal memuat santri kelas");
      }
    } finally {
      if (studentRequestId.current === requestId) {
        setSantriLoading(false);
      }
    }
  };

  useEffect(() => {
    studentRequestId.current += 1;
    setKelasId("");
    setSantri([]);
    setSantriLoading(false);
    setSantriError("");
    getKelas();
  }, [activeUnitId]);

  useEffect(() => {
    setDirtyKeys(new Set());
    getHafalan(bulan, tahun);
  }, [bulan, tahun, activeUnitId]);

  const handleHafalan = (pekan, santriId, field, value) => {
    const key = `${pekan}-${santriId}-${bulan}-${tahun}`;
    setHafalan((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }));
    setDirtyKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  const simpanHafalan = async () => {
    if (savingRef.current) return;
    const entries = Array.from(dirtyKeys)
      .map((key) => [key, hafalan[key]])
      .filter(([, val]) => val && (val.kitab || val.awal || val.akhir || val.catatan));

    if (entries.length === 0) {
      alert("Tidak ada perubahan hafalan yang perlu disimpan.");
      return;
    }

    savingRef.current = true;
    const submittedRequestId = hafalanRequestId.current;
    try {
      setSaving(true);
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });
      const payloads = entries.map(([key, data]) => {
        const segments = key.split("-");
        const tahunKey = parseInt(segments[segments.length - 1], 10);
        const bulanKey = parseInt(segments[segments.length - 2], 10);
        const santriId = segments[segments.length - 3];
        const pekan = segments[segments.length - 4];

        if (isNaN(tahunKey) || isNaN(bulanKey) || !santriId || !pekan) {
          throw new Error(`Key hafalan tidak valid: ${key}`);
        }
        return {
          key,
          body: {
            ...unitPayload,
            santri_id: santriId,
            tanggal: new Date().toISOString().split("T")[0],
            kitab: data.kitab || "",
            awal: data.awal || "",
            akhir: data.akhir || "",
            catatan: data.catatan || "",
            bulan: bulanKey,
            tahun: tahunKey,
            pekan,
          },
        };
      });

      for (let offset = 0; offset < payloads.length; offset += 8) {
        await Promise.all(payloads.slice(offset, offset + 8).map(({ body }) => api.post("/hafalan", body)));
      }
      setDirtyKeys((current) => {
        const next = new Set(current);
        payloads.forEach(({ key }) => next.delete(key));
        return next;
      });
      alert(`Hafalan berhasil disimpan (${payloads.length} entri).`);
      if (hafalanRequestId.current === submittedRequestId) void getHafalan(bulan, tahun);
    } catch (err) {
      console.error(err);
      alert("Gagal simpan: " + (err.response?.data?.error || err.message));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleExport = () => {
    const rows = [];

    santri.forEach((s) => {
      pekanList.forEach((p) => {
        const data = hafalan[`${p}-${s.id}-${bulan}-${tahun}`] || {};

        rows.push({
          Nama: s.nama,
          Pekan: p,
          Kitab: data.kitab || "",
          Awal: data.awal || "",
          Akhir: data.akhir || "",
          Catatan: data.catatan || "",
        });
      });
    });

    exportExcel(rows, "Hafalan");
  };

  return (
    <AppShell title="Hafalan Mingguan" breadcrumb="Akademik / Hafalan Mingguan">
      <AkademikResponsiveStyles />
      <OperationalPageStyles />
      <div className="akademik-page ops-page">
      <div className="ops-page__form-card">
      <Card padding="md" shadow="card" border={false} radius="xl">
        <div className="akademik-filter-panel ops-page__filter filter-bar-v3 filter-bar-v3--table">
          <span className="filter-bar-v3__label">
            <FaFilter size={11} aria-hidden />
            Filter hafalan
          </span>
          <div className="filter-bar-v3__fields" style={filterPanelStyle}>
          <select
            className="form-select-v3"
            value={kelasId}
            onChange={(e) => {
              setKelasId(e.target.value);
              getSantri(e.target.value);
            }}
          >
            <option value="">Pilih Kelas</option>
            {kelas.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama_kelas}
              </option>
            ))}
          </select>

          <select className="form-select-v3" value={bulan} onChange={(e) => setBulan(e.target.value)}>
            {MONTH_OPTIONS_ID.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <input
            className="form-control-v3"
            type="number"
            value={tahun}
            onChange={(e) => setTahun(e.target.value)}
            aria-label="Tahun"
          />
          </div>
        </div>
      </Card>
      </div>

      {!kelasId ? (
        <div className="ops-page__empty">
          <EmptyState
            title="Pilih kelas terlebih dahulu"
            description="Pilih kelas, bulan, dan tahun untuk mengisi hafalan mingguan santri."
          />
        </div>
      ) : santriLoading ? (
        <div className="ops-page__empty">
          <EmptyState title="Memuat santri kelas" description="Menyiapkan daftar enrollment aktif..." />
        </div>
      ) : santriError ? (
        <div className="ops-page__empty">
          <EmptyState title="Gagal memuat santri kelas" description={santriError} />
        </div>
      ) : santri.length === 0 ? (
        <div className="ops-page__empty">
          <EmptyState
            title="Belum ada santri di kelas ini"
            description="Tidak ada enrollment santri aktif pada kelas yang dipilih."
          />
        </div>
      ) : (
      <>
      {pekanList.map((pekan) => (
        <div key={pekan} className="ops-akademik-card ops-page__card">
          <Card padding="md" shadow="card" border={false} radius="xl">
            <SectionHeading variant="eyebrow" spacing="first">
              Pekan {pekan}
            </SectionHeading>

            <div style={{ marginTop: "var(--space-4)" }}>
            <TableScroll matrix sticky>
            <Table>
              <thead>
                <tr>
                  <th className="table-v3__col--sticky">Nama</th>
                  <th>Kitab</th>
                  <th>Awal</th>
                  <th>Akhir</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {santri.map((s) => {
                  const key = `${pekan}-${s.id}-${bulan}-${tahun}`;

                  return (
                    <tr key={key}>
                      <td className="table-v3__col--sticky table-v3__cell--strong">{s.nama}</td>
                      <td>
                        <input
                          className="ops-hafalan-input"
                          type="text"
                          disabled={saving}
                          value={hafalan[`${pekan}-${s.id}-${bulan}-${tahun}`]?.kitab || ""}
                          onChange={(e) =>
                            handleHafalan(pekan, s.id, "kitab", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="ops-hafalan-input"
                          type="text"
                          disabled={saving}
                          value={hafalan[`${pekan}-${s.id}-${bulan}-${tahun}`]?.awal || ""}
                          onChange={(e) =>
                            handleHafalan(pekan, s.id, "awal", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="ops-hafalan-input"
                          type="text"
                          disabled={saving}
                          value={hafalan[`${pekan}-${s.id}-${bulan}-${tahun}`]?.akhir || ""}
                          onChange={(e) =>
                            handleHafalan(pekan, s.id, "akhir", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="ops-hafalan-input"
                          type="text"
                          disabled={saving}
                          value={hafalan[`${pekan}-${s.id}-${bulan}-${tahun}`]?.catatan || ""}
                          onChange={(e) =>
                            handleHafalan(pekan, s.id, "catatan", e.target.value)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            </TableScroll>
            </div>
          </Card>
        </div>
      ))}

      <div style={{ ...actionBarStyle, marginTop: "var(--space-4)" }}>
        <Button variant="success" onClick={handleExport}>
          Export Excel
        </Button>
        <Button variant="primary" onClick={simpanHafalan} disabled={saving || dirtyKeys.size === 0 || !activeUnitId}>
          {saving ? "Menyimpan..." : dirtyKeys.size ? `Simpan Hafalan (${dirtyKeys.size})` : "Simpan Hafalan"}
        </Button>
      </div>
      </>
      )}
      </div>
    </AppShell>
  );
}

export default HafalanPage;
