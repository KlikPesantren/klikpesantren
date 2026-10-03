import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {useActiveUnit} from "../context/ActiveUnitContext";
import AttendanceDeviceControls from "../components/AttendanceDeviceControls";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import KpiCard from "../components/ui/KpiCard";
import KpiGrid from "../components/ui/KpiGrid";
import { formatNumber } from "../utils/formatCurrency";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import { Table, TableScroll, TablePagination, useClientPagination } from "../components/ui/table";

function RFIDDevicePage() {  const [devices, setDevices] = useState([]);
  const {activeUnitId,units}=useActiveUnit();
  const requestId=useRef(0);
  const unitRef=useRef(activeUnitId);
  useLayoutEffect(()=>{unitRef.current=activeUnitId;},[activeUnitId]);
  const [deviceUnitId,setDeviceUnitId]=useState(null);
  const scopedDevices=deviceUnitId===activeUnitId ? devices : [];
  const [loadError,setLoadError]=useState("");
  const [tableSearch, setTableSearch] = useState("");

  const loadData = useCallback(async () => {
    if(unitRef.current!==activeUnitId)return;
    const id=++requestId.current;
    if(!activeUnitId){setDevices([]);return;}
    try {
      const res = await api.get("/rfid/device/attendance",{params:{unit_id:activeUnitId}});
      if(id===requestId.current && unitRef.current===activeUnitId){setDeviceUnitId(activeUnitId);setDevices(res.data.data || []);setLoadError("");}
    } catch (err) {
      if(id===requestId.current){setDevices([]);setLoadError(err.response?.data?.error || "Gagal memuat perangkat");}
    }
  },[activeUnitId]);

  useEffect(() => {
    queueMicrotask(loadData);

    const interval = setInterval(loadData, 10000);

    // Epoch invalidation intentionally happens on cleanup, not a captured request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {requestId.current++;clearInterval(interval);};
  }, [loadData]);

  const filteredDevices = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const current=deviceUnitId===activeUnitId ? devices : [];
    if (!q) return current;
    return current.filter((d) =>
      [d.id, d.device_id, d.status, d.ip_address, d.firmware_version]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [devices, tableSearch,deviceUnitId,activeUnitId]);

  const { page, setPage, paginatedItems, totalItems, pageSize } = useClientPagination(filteredDevices);

  useEffect(() => {
    setPage(1);
  }, [tableSearch, setPage]);

  const online = scopedDevices.filter((d) => d.status === "online").length;
  const offline = scopedDevices.filter((d) => d.status !== "online").length;
  const synced = scopedDevices.filter((d) => d.last_sync).length;

  return (
    <AppShell
      title="Perangkat EDC"
      description="Monitoring dan pengelolaan perangkat pada unit aktif"
      breadcrumb="RFID / Perangkat EDC"
    >
      {!activeUnitId && <p>Pilih satu unit untuk memuat dan mengelola perangkat.</p>}
      {loadError && <p role="alert">{loadError}</p>}
      <AttendanceDeviceControls key={activeUnitId || "none"} unitId={activeUnitId} units={units} devices={scopedDevices} onSaved={loadData}/>
      <KpiGrid>
        <KpiCard label="Total Device" value={formatNumber(scopedDevices.length)} accent="primary" />
        <KpiCard label="Device Online" value={formatNumber(online)} accent="success" />
        <KpiCard label="Device Offline" value={formatNumber(offline)} accent="danger" />
        <KpiCard label="Sync" value={formatNumber(synced)} accent="info" />
      </KpiGrid>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Daftar Perangkat RFID"
          subtitle="Status koneksi dan sinkronisasi EDC"
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {filteredDevices.length} device
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Cari device ID, IP, firmware..."
              />
            }
          />

          {filteredDevices.length === 0 ? (
            <EmptyState
              title={devices.length === 0 ? "Belum ada perangkat" : "Tidak ada hasil pencarian"}
              description={
                devices.length === 0
                  ? "Perangkat EDC akan muncul setelah terdaftar."
                  : "Coba kata kunci lain atau hapus filter pencarian."
              }
            />
          ) : (
            <>
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Device</th>
                    <th>Status</th>
                    <th>IP Address</th>
                    <th>Last Ping</th>
                    <th>Last Sync</th>
                    <th>Firmware</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((d) => (
                    <tr key={d.id}>
                      <td>{d.id}</td>
                      <td className="table-v3__cell--strong">{d.nama_device || d.device_id}<br/>{d.attendance_mode || "Legacy / mode belum ditentukan"}</td>
                      <td>
                        <StatusBadge status={d.status} />
                      </td>
                      <td>{d.ip_address ? d.ip_address.replace("::ffff:", "") : "—"}</td>
                      <td className="table-v3__cell--mono">
                        {d.last_ping ? new Date(d.last_ping).toLocaleString() : "—"}
                      </td>
                      <td className="table-v3__cell--mono">
                        {d.last_sync ? new Date(d.last_sync).toLocaleString() : "—"}
                      </td>
                      <td>{d.firmware_version || "—"}</td>
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
          )}        </DataTableCard>
      </div>
    </AppShell>
  );
}

export default RFIDDevicePage;
