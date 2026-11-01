import { useCallback, useEffect, useMemo, useState } from "react";
import { FaMicrochip, FaSearch, FaSignal, FaWifi } from "react-icons/fa";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import DataTableCard from "../components/ui/DataTableCard";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import {
  Table,
  TableScroll,
  TablePagination,
  useClientPagination,
} from "../components/ui/table";
import useVisibilityPolling from "../hooks/useVisibilityPolling";

function DevicePageStyles() {
  return (
    <style>{`
      .device-page {
        min-width: 0;
        max-width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .device-page__summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--space-4);
      }

      .device-page__stat {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: var(--space-4) var(--space-5);
        box-shadow: 0 2px 16px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.04);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;
      }

      .device-page__stat-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
      }

      .device-page__stat-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .device-page__stat-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 12px;
        font-size: 15px;
      }

      .device-page__stat-icon--total {
        background: var(--primary-subtle);
        color: var(--primary);
      }

      .device-page__stat-icon--online {
        background: var(--primary-subtle);
        color: var(--primary);
      }

      .device-page__stat-icon--offline {
        background: var(--neutral-subtle);
        color: var(--text-muted);
      }

      .device-page__stat-value {
        font-size: clamp(1.375rem, 2.2vw, 1.75rem);
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: -0.03em;
        line-height: 1.1;
      }

      .device-page__card > div {
        border: 1px solid var(--border) !important;
        border-radius: 20px !important;
        box-shadow: 0 2px 16px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.04) !important;
        overflow: hidden;
      }

      .device-page__meta {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--primary-subtle);
        color: var(--primary);
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
      }

      .device-page__refresh {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: var(--space-4);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        background: var(--neutral-subtle);
        border: 1px solid var(--border);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 500;
        line-height: 1.4;
      }

      .device-page__filter {
        margin-bottom: var(--space-4);
      }

      .device-page__empty {
        border: 1px dashed var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
      }

      .device-page__empty > div {
        min-height: 220px;
      }

      .device-page__empty [aria-hidden] {
        background: var(--primary-subtle) !important;
        color: var(--primary) !important;
      }

      .device-page .table-v3 thead th {
        background: var(--neutral-subtle);
      }

      .device-page .table-v3 tbody tr:hover td {
        background: var(--surface-muted);
      }

      .device-status-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        white-space: nowrap;
      }

      .device-status-badge__dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .device-status-badge--online {
        background: var(--primary-subtle);
        color: var(--primary);
      }

      .device-status-badge--online .device-status-badge__dot {
        background: var(--primary);
        box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.18);
      }

      .device-status-badge--offline {
        background: var(--neutral-subtle);
        color: var(--text-secondary);
      }

      .device-status-badge--offline .device-status-badge__dot {
        background: var(--text-muted);
      }

      @media (max-width: 767px) {
        .device-page__summary {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}

function DeviceStatusBadge({ online }) {
  return (
    <span
      className={`device-status-badge${
        online ? " device-status-badge--online" : " device-status-badge--offline"
      }`}
    >
      <span className="device-status-badge__dot" aria-hidden />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function DevicePage() {
  const [devices, setDevices] = useState([]);
  const [tableSearch, setTableSearch] = useState("");

  const getDevices = useCallback(async () => {
    try {
      const res = await api.get("/devices");
      setDevices(res.data.data || []);
    } catch (err) {
      console.error(err);
      setDevices([]);
    }
  }, []);
  useVisibilityPolling(getDevices,60000);

  const isOnline = (last_ping) => {
    if (!last_ping) return false;

    const now = new Date();
    const ping = new Date(last_ping);
    const diff = (now - ping) / 1000;

    return diff < 15;
  };

  const filteredDevices = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) =>
      [d.id, d.nama_device, d.device_id, d.ip_address, d.last_ping]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [devices, tableSearch]);

  const deviceStats = useMemo(() => {
    const online = devices.filter((d) => isOnline(d.last_ping)).length;
    return {
      total: devices.length,
      online,
      offline: devices.length - online,
    };
  }, [devices]);

  const { page, setPage, paginatedItems, totalItems, pageSize } =
    useClientPagination(filteredDevices);

  useEffect(() => {
    setPage(1);
  }, [tableSearch, setPage]);

  return (
    <AppShell title="Device Monitoring" breadcrumb="Sistem / Perangkat">
      <DevicePageStyles />
      <div className="device-page">
        <button type="button" className="secondary" onClick={getDevices}>Segarkan perangkat</button>
        <div className="device-page__summary">
          <div className="device-page__stat">
            <div className="device-page__stat-head">
              <span className="device-page__stat-label">Total Device</span>
              <span className="device-page__stat-icon device-page__stat-icon--total" aria-hidden>
                <FaMicrochip />
              </span>
            </div>
            <span className="device-page__stat-value">{deviceStats.total}</span>
          </div>
          <div className="device-page__stat">
            <div className="device-page__stat-head">
              <span className="device-page__stat-label">Online</span>
              <span className="device-page__stat-icon device-page__stat-icon--online" aria-hidden>
                <FaWifi />
              </span>
            </div>
            <span className="device-page__stat-value">{deviceStats.online}</span>
          </div>
          <div className="device-page__stat">
            <div className="device-page__stat-head">
              <span className="device-page__stat-label">Offline</span>
              <span className="device-page__stat-icon device-page__stat-icon--offline" aria-hidden>
                <FaSignal />
              </span>
            </div>
            <span className="device-page__stat-value">{deviceStats.offline}</span>
          </div>
        </div>

        <div className="device-page__card">
          <DataTableCard
            title="Status Perangkat"
            subtitle="Monitoring koneksi perangkat secara real-time"
            border
            actions={
              <span className="device-page__meta">
                {filteredDevices.length} perangkat
              </span>
            }
          >
            <div className="device-page__refresh">
              <FaWifi size={11} aria-hidden />
              Pembaruan otomatis setiap 3 detik
            </div>

            <div className="device-page__filter filter-bar-v3 filter-bar-v3--table">
              <span className="filter-bar-v3__label">
                <FaSearch size={11} aria-hidden />
                Cari device
              </span>
              <div className="filter-bar-v3__fields">
                <SearchInput
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Cari ID, nama device, IP..."
                />
              </div>
            </div>

            {filteredDevices.length === 0 ? (
              <div className="device-page__empty">
                <EmptyState
                  title={
                    devices.length === 0
                      ? "Belum ada perangkat terdaftar"
                      : "Tidak ada hasil pencarian"
                  }
                  description={
                    devices.length === 0
                      ? "Perangkat akan muncul setelah terhubung ke sistem."
                      : "Coba kata kunci lain atau hapus filter pencarian."
                  }
                />
              </div>
            ) : (
              <>
                <TableScroll>
                  <Table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Nama Device</th>
                        <th>Device ID</th>
                        <th>Status</th>
                        <th>IP</th>
                        <th>Last Ping</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedItems.map((d) => {
                        const online = isOnline(d.last_ping);
                        return (
                          <tr key={d.id}>
                            <td className="table-v3__cell--muted">{d.id}</td>
                            <td className="table-v3__cell--strong">
                              {d.nama_device || "—"}
                            </td>
                            <td>{d.device_id}</td>
                            <td>
                              <DeviceStatusBadge online={online} />
                            </td>
                            <td>{d.ip_address || "—"}</td>
                            <td className="table-v3__cell--mono">
                              {d.last_ping
                                ? new Date(d.last_ping).toLocaleString()
                                : "—"}
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
      </div>
    </AppShell>
  );
}

export default DevicePage;
