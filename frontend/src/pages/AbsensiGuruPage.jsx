import { useCallback, useEffect, useRef, useState } from "react";

import api from "../services/api";

import AppShell from "../layouts/AppShell";
import { useActiveUnit } from "../context/ActiveUnitContext";

import Card from "../components/ui/Card";

import SectionHeading from "../components/ui/SectionHeading";

import StatusBadge from "../components/ui/StatusBadge";

import Button, { actionBarStyle } from "../components/ui/Button";
import { Table, TableScroll } from "../components/ui/table";
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
      }

      .akademik-filter-panel.filter-bar-v3 {
        margin-bottom: 0;
      }

      .akademik-filter-panel .filter-bar-v3__fields select,
      .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
        min-width: 0;
        flex: 1 1 140px;
        max-width: 220px;
      }

      .absensi-guru-input {
        width: 92px;
        min-height: 36px;
        flex: initial;
        text-align: center;
        box-sizing: border-box;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface);
        color: var(--text-primary);
        padding: 6px 8px;
        font: inherit;
      }

      .absensi-guru-input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--focus-ring);
      }

      @media (max-width: 767px) {
        .akademik-filter-panel .filter-bar-v3__fields select,
        .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
          flex: 1 1 100%;
          max-width: 100%;
        }
      }
    `}</style>
  );
}



const STATUS_COLUMNS = [

  { key: "total_hadir", label: "Hadir", variant: "success" },

  { key: "total_izin", label: "Izin", variant: "info" },

  { key: "total_sakit", label: "Sakit", variant: "warning" },

  { key: "total_alfa", label: "Alfa", variant: "danger" },

];



function AbsensiGuruPage() {

  const [guru, setGuru] = useState([]);

  const [data, setData] = useState({});

  const [bulan, setBulan] = useState(new Date().getMonth() + 1);

  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestIdRef = useRef(0);
  const savingRef = useRef(false);
  const { activeUnit, activeUnitId, allUnitsAllowed } = useActiveUnit();
  const canWrite = Boolean(activeUnitId);

  const loadScopedAttendance = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setGuru([]);
    setData({});
    setError("");
    if (!activeUnitId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = { unit_id: activeUnitId };
      const [guruResponse, attendanceResponse] = await Promise.all([
        api.get("/guru", { params }),
        api.get("/absensi-guru", { params }),
      ]);
      if (requestIdRef.current !== requestId) return;
      setGuru(guruResponse.data.data || []);

      const nextData = {};
      (attendanceResponse.data.data || []).forEach((row) => {
        if (Number(row.bulan) === Number(bulan) && Number(row.tahun) === Number(tahun)) {
          nextData[row.guru_id] = {
            total_hadir: row.total_hadir,
            total_izin: row.total_izin,
            total_sakit: row.total_sakit,
            total_alfa: row.total_alfa,
          };
        }
      });
      setData(nextData);
    } catch (err) {
      console.error(err);
      if (requestIdRef.current === requestId) {
        setError(err.response?.data?.error || "Gagal memuat absensi guru");
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [activeUnitId, bulan, tahun]);

  useEffect(() => {
    loadScopedAttendance();
    return () => { requestIdRef.current += 1; };
  }, [loadScopedAttendance]);



  const handleInput = (guruId, field, value) => {
    setData((current) => ({
      ...current,
      [guruId]: {
        ...current[guruId],
        [field]: value,
      },
    }));
  };



  const simpan = async () => {
    if (savingRef.current) return;
    if (!canWrite) {
      alert("Pilih satu unit aktif untuk menyimpan absensi guru.");
      return;
    }

    savingRef.current = true;
    const submittedRequestId = requestIdRef.current;
    setSaving(true);
    try {
      for (const guruId in data) {
        const d = data[guruId];
        await api.post("/absensi-guru", {
          guru_id: guruId,
          bulan,
          tahun,
          unit_id: activeUnitId,
          total_hadir: d.total_hadir || 0,
          total_izin: d.total_izin || 0,
          total_sakit: d.total_sakit || 0,
          total_alfa: d.total_alfa || 0,
        });
      }
      alert("Absensi guru berhasil disimpan");
      if (requestIdRef.current === submittedRequestId) {
        await loadScopedAttendance();
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal menyimpan absensi guru");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };







  return (

    <AppShell title="Absensi Guru" breadcrumb="Akademik / Absensi Guru">

      <AkademikResponsiveStyles />

      <div className="akademik-page">

      <Card padding="md" shadow="card" border={false} radius="xl">

        <div className="akademik-filter-panel ops-page__filter filter-bar-v3 filter-bar-v3--table">
          <span className="filter-bar-v3__label">Filter absensi guru</span>
          <div className="filter-bar-v3__fields" style={filterPanelStyle}>
            <select
              className="form-select-v3"
              value={bulan}
              onChange={(e) => setBulan(e.target.value)}
            >
              {MONTH_OPTIONS_ID.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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

      <div style={{ marginTop: "var(--space-4)" }}>
        {activeUnitId ? (
          <StatusBadge status={`Workspace: ${activeUnit?.nama || activeUnit?.kode || "Unit aktif"}`} variant="info" />
        ) : (
          <StatusBadge status={`Workspace: ${allUnitsAllowed ? "Semua Unit" : "Unit belum dipilih"} - pilih satu unit untuk absensi guru.`} variant="warning" />
        )}
      </div>

      {error ? (
        <div className="form-error-v3" style={{ marginTop: "var(--space-4)" }}>
          {error}
        </div>
      ) : null}



      <div style={{ marginTop: "var(--space-6)" }}>

        <Card padding="md" shadow="card" border={false} radius="xl">

          <SectionHeading variant="eyebrow" spacing="first">

            Rekap Absensi Guru

          </SectionHeading>



          <div style={{ marginTop: "var(--space-4)" }}>
          <TableScroll matrix sticky>
          <Table>
            <thead>
              <tr>
                <th className="table-v3__col--sticky">Nama Guru</th>
                <th>Jabatan</th>
                {STATUS_COLUMNS.map((col) => (
                  <th key={col.key}>
                    <StatusBadge status={col.label} size="sm" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guru.map((g) => (
                <tr key={g.id}>
                  <td className="table-v3__col--sticky table-v3__cell--strong">{g.nama}</td>
                  <td>{g.jabatan}</td>
                  {STATUS_COLUMNS.map((col) => (
                    <td key={col.key}>
                      <input
                        className="absensi-guru-input"
                        type="number"
                        disabled={!canWrite || saving}
                        value={data[g.id]?.[col.key] || ""}
                        onChange={(e) =>
                          handleInput(g.id, col.key, e.target.value)
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {!guru.length ? (
                <tr>
                  <td colSpan={STATUS_COLUMNS.length + 2} className="table-v3__empty">
                    {loading ? "Memuat data guru..." : !activeUnitId ? "Pilih satu unit aktif terlebih dahulu." : "Tidak ada guru pada workspace ini."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </Table>
          </TableScroll>
          </div>



          <div style={{ ...actionBarStyle, marginTop: "var(--space-4)" }}>

            <Button variant="primary" onClick={simpan} disabled={!canWrite || saving || loading}>
              {saving ? "Menyimpan..." : "Simpan Absensi Guru"}
            </Button>

          </div>

        </Card>

      </div>

      </div>

    </AppShell>

  );

}



export default AbsensiGuruPage;

