import { useCallback, useMemo, useState } from "react";
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
import { Table, TableScroll } from "../components/ui/table";
import useVisibilityPolling from "../hooks/useVisibilityPolling";

function RFIDMonitorPage() {  const [devices, setDevices] = useState([]);
  const [tableSearch, setTableSearch] = useState("");

  const getData = useCallback(async () => {
    try {
      const res = await api.get("/rfid/monitor");
      setDevices(res.data.data);
    } catch (err) {
      console.error(err);
    }
  }, []);
  useVisibilityPolling(getData,30000);

  const filteredDevices = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((item) =>
      [item.device_id, item.nama_merchant, item.status, item.total_transaksi_hari_ini]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [devices, tableSearch]);

  const online = devices.filter((d) => d.status === "online").length;
  const offline = devices.filter((d) => d.status !== "online").length;
  const totalTransaksi = devices.reduce(
    (a, b) => a + Number(b.total_transaksi_hari_ini || 0),
    0,
  );

  return (
    <AppShell
      title="RFID Monitor"
      description="Monitoring perangkat RFID pesantren"
      breadcrumb="Keamanan / RFID Monitor"
    >
      <KpiGrid>
        <KpiCard label="Device Online" value={formatNumber(online)} accent="success" />
        <KpiCard label="Device Offline" value={formatNumber(offline)} accent="danger" />
        <KpiCard label="Total Device" value={formatNumber(devices.length)} accent="primary" />
        <KpiCard label="Transaksi Hari Ini" value={formatNumber(totalTransaksi)} accent="info" />
      </KpiGrid>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Status Perangkat"
          subtitle="Monitoring perangkat RFID secara realtime"
          actions={
            <><button type="button" className="secondary" onClick={getData}>Segarkan</button>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                {filteredDevices.length} device
              </span></>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Cari device, merchant, status..."
              />
            }
          />

          {filteredDevices.length === 0 ? (
            <EmptyState
              title={devices.length === 0 ? "Belum ada perangkat" : "Tidak ada hasil pencarian"}
              description={
                devices.length === 0
                  ? "Perangkat RFID akan muncul setelah terhubung ke sistem."
                  : "Coba kata kunci lain atau hapus filter pencarian."
              }
            />
          ) : (
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Merchant</th>
                    <th>Status</th>
                    <th>Last Ping</th>
                    <th>Last Sync</th>
                    <th>Transaksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.map((item) => (
                    <tr key={item.id}>
                      <td className="table-v3__cell--strong">{item.device_id}</td>
                      <td>{item.nama_merchant}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td>
                        {item.last_ping ? new Date(item.last_ping).toLocaleString() : "—"}
                      </td>
                      <td>
                        {item.last_sync ? new Date(item.last_sync).toLocaleString() : "—"}
                      </td>
                      <td className="table-v3__cell--strong">{item.total_transaksi_hari_ini}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}        </DataTableCard>
      </div>
    </AppShell>
  );
}

export default RFIDMonitorPage;
