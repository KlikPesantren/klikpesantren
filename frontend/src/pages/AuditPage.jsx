import { useCallback, useEffect, useMemo, useState } from "react";
import { FaClipboardList, FaSync } from "react-icons/fa";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import DataTableCard from "../components/ui/DataTableCard";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import {
  Table,
  TableScroll,
  TablePagination,
  useClientPagination,
} from "../components/ui/table";
import useVisibilityPolling from "../hooks/useVisibilityPolling";

function AuditPageStyles() {
  return (
    <style>{`
      .audit-page {
        min-width: 0;
        max-width: 100%;
      }

      .audit-page__card > div {
        border: 1px solid var(--border) !important;
        border-radius: 20px !important;
        box-shadow: 0 2px 16px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.04) !important;
        overflow: hidden;
      }

      .audit-page__meta {
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

      .audit-page__refresh {
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

      .audit-page__filter {
        margin-bottom: var(--space-4);
      }

      .audit-page__filter .filter-bar-v3__label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .audit-page__empty {
        border: 1px dashed var(--border);
        border-radius: 20px;
        background: var(--surface);
      }

      .audit-page__empty > div {
        min-height: 220px;
      }

      .audit-page__empty [aria-hidden] {
        background: var(--primary-subtle) !important;
        color: var(--primary) !important;
      }

      .audit-page .table-v3 thead th {
        background: var(--neutral-subtle);
      }

      .audit-page .table-v3 tbody tr:hover td {
        background: var(--surface-muted);
      }

      .audit-event-badge span {
        font-weight: 600 !important;
        letter-spacing: 0.01em;
      }

      @media (max-width: 767px) {
        .audit-page__meta {
          font-size: 11px;
        }
      }
    `}</style>
  );
}

function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [tableSearch, setTableSearch] = useState("");

  const getLogs = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");

      const response = await api.get("/audit", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setLogs(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);
  useVisibilityPolling(getLogs,60000);

  const filteredLogs = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) =>
      [log.id, log.device_id, log.event_type, log.detail, log.created_at]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [logs, tableSearch]);

  const { page, setPage, paginatedItems, totalItems, pageSize } =
    useClientPagination(filteredLogs);

  useEffect(() => {
    setPage(1);
  }, [tableSearch, setPage]);

  return (
    <AppShell title="Audit Log" breadcrumb="Sistem / Audit">
      <AuditPageStyles />
      <div className="audit-page">
        <div className="audit-page__card">
          <DataTableCard
            title="Log Aktivitas Device"
            subtitle="Riwayat event perangkat tercatat otomatis"
            border
            actions={
              <span className="audit-page__meta">
                {filteredLogs.length} entri
              </span>
            }
          >
            <div className="audit-page__refresh">
              <FaSync size={11} aria-hidden />
              Pembaruan otomatis setiap 60 detik saat tab aktif
              <button type="button" className="secondary" onClick={getLogs}>Segarkan sekarang</button>
            </div>

            <div className="audit-page__filter filter-bar-v3 filter-bar-v3--table">
              <span className="filter-bar-v3__label">
                <FaClipboardList size={11} aria-hidden />
                Cari log
              </span>
              <div className="filter-bar-v3__fields">
                <SearchInput
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Cari device, event, detail..."
                />
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="audit-page__empty">
                <EmptyState
                  title={
                    logs.length === 0 ? "Belum ada log audit" : "Tidak ada hasil pencarian"
                  }
                  description={
                    logs.length === 0
                      ? "Aktivitas perangkat akan tercatat di sini secara otomatis."
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
                        <th>Device</th>
                        <th>Event</th>
                        <th>Detail</th>
                        <th>Waktu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedItems.map((log) => (
                        <tr key={log.id}>
                          <td className="table-v3__cell--muted">{log.id}</td>
                          <td className="table-v3__cell--strong">{log.device_id}</td>
                          <td>
                            <span className="audit-event-badge">
                              <StatusBadge status={log.event_type} size="sm" />
                            </span>
                          </td>
                          <td>{log.detail || "—"}</td>
                          <td className="table-v3__cell--mono">
                            {new Date(log.created_at).toLocaleString()}
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
      </div>
    </AppShell>
  );
}

export default AuditPage;
