import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaFileInvoice, FaMoneyBillWave } from "react-icons/fa";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import KpiCard from "../components/ui/KpiCard";
import KpiGrid from "../components/ui/KpiGrid";
import Modal from "../components/Modal";
import Button from "../components/ui/Button";
import SahriyahHistoriModal from "../components/sahriyah/SahriyahHistoriModal";
import SahriyahInvoiceModal from "../components/sahriyah/SahriyahInvoiceModal";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import {
  Table,
  TableScroll,
  TableActions,
  TablePagination,
} from "../components/ui/table";
import { DEFAULT_PAGE_SIZE } from "../hooks/useClientPagination";
import {
  FormField,
  Input,
  Select,
  FormGrid,
  FormActionBar,
  FilterBar,
} from "../components/ui/form";
import { exportExcel } from "../utils/exportExcel";
import { formatCurrency, formatNumber } from "../utils/formatCurrency";
import { KeuanganPageStyles } from "../components/shared/PageResponsiveStyles";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

function getApiError(err, fallback = "Terjadi kesalahan. Silakan coba lagi.") {
  return err?.response?.data?.error || fallback;
}

function isSahriyahLunas(status) {
  return String(status || "").trim().toLowerCase() === "lunas";
}

function buildSahriyahParams({
  bulan,
  tahun,
  search,
  filterStatus,
  filterKelas,
  page,
  limit = DEFAULT_PAGE_SIZE,
}) {
  const params = {
    bulan,
    tahun,
    limit,
    offset: (page - 1) * limit,
  };

  if (search.trim()) params.search = search.trim();
  if (filterStatus) params.status = filterStatus;
  if (filterKelas) params.kelas_id = filterKelas;

  return params;
}

function SahriyahPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    lunas: 0,
    belum_lunas: 0,
    total_nominal: 0,
    lunas_nominal: 0,
    belum_lunas_nominal: 0,
    partial_count: 0,
    partial_nominal_tagihan: 0,
    partial_sudah_dibayar: 0,
    partial_sisa: 0,
  });
  const [pagination, setPagination] = useState({
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [isLoadingTable, setIsLoadingTable] = useState(false);
  const [showBayar, setShowBayar] = useState(false);
  const [selectedTagihan, setSelectedTagihan] = useState(null);
  const [formBayar, setFormBayar] = useState({
    nominal: "",
    beras: "",
    petugas: "",
  });
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterKelas, setFilterKelas] = useState("");
  const [kelas, setKelas] = useState([]);
  const [showRiwayat, setShowRiwayat] = useState(false);
  const [riwayat, setRiwayat] = useState([]);
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [isSavingBayar, setIsSavingBayar] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);

  const searchDebounceRef = useRef(null);

  const fetchSahriyah = useCallback(
    async (pageNum = 1) => {
      setIsLoadingTable(true);

      try {
        const params = buildSahriyahParams({
          bulan,
          tahun,
          search,
          filterStatus,
          filterKelas,
          page: pageNum,
        });
        Object.assign(params, readScopeParams);

        const response = await api.get("/sahriyah", { params });
        setData(response.data.data || []);
        setPagination(
          response.data.pagination || {
            limit: DEFAULT_PAGE_SIZE,
            offset: 0,
            total: 0,
          },
        );
        setSummary(
          response.data.summary || {
            total: 0,
             lunas: 0,
             belum_lunas: 0,
             total_nominal: 0,
             lunas_nominal: 0,
             belum_lunas_nominal: 0,
             partial_count: 0,
             partial_nominal_tagihan: 0,
             partial_sudah_dibayar: 0,
             partial_sisa: 0,
          },
        );
        setPage(pageNum);
      } catch (err) {
        console.error(err);
        alert(getApiError(err, "Gagal memuat data sahriyah"));
      } finally {
        setIsLoadingTable(false);
      }
    },
    [bulan, tahun, search, filterStatus, filterKelas, readScopeParams],
  );

  useEffect(() => {
    api.get("/kelas", { params: readScopeParams }).then((res) => setKelas(res.data.data || [])).catch(console.error);
  }, [readScopeParams]);

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      fetchSahriyah(1);
    }, search.trim() ? 300 : 0);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [bulan, tahun, search, filterStatus, filterKelas, fetchSahriyah]);

  const generateTagihan = async () => {
    setIsGenerating(true);

    try {
      const response = await api.post("/sahriyah/generate", {
        bulan,
        tahun,
        ...requireActiveUnitForWrite({ activeUnitId }),
      });
      const {
        created_count = 0,
        skipped_count = 0,
        skipped_existing_count = 0,
        skipped_no_setting_count = 0,
        total_target = 0,
      } = response.data || {};

      alert(
        `Generate selesai.\n\nDibuat: ${created_count}\nSudah ada: ${skipped_existing_count || skipped_count}\nTanpa setting sahriyah: ${skipped_no_setting_count}\nTarget santri aktif: ${total_target}`,
      );
      await fetchSahriyah(1);
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Generate tagihan gagal"));
    } finally {
      setIsGenerating(false);
    }
  };

  const bayarTagihan = (tagihan) => {
    if (isSahriyahLunas(tagihan.status)) return;
    setSelectedTagihan(tagihan);
    setFormBayar({ nominal: "", beras: "", petugas: "" });
    setShowBayar(true);
  };

  const tutupBayar = () => {
    if (isSavingBayar) return;
    setShowBayar(false);
    setSelectedTagihan(null);
    setFormBayar({ nominal: "", beras: "", petugas: "" });
  };

  const isiBayarSisaUang = () => {
    if (!selectedTagihan) return;
    const sisa = Math.max(0, Number(selectedTagihan.sisa_tagihan || 0));
    setFormBayar((prev) => ({ ...prev, nominal: sisa > 0 ? String(sisa) : "" }));
  };

  const isiBayarSisaBeras = () => {
    if (!selectedTagihan) return;
    const sisa = Math.max(0, Number(selectedTagihan.sisa_beras || 0));
    setFormBayar((prev) => ({ ...prev, beras: sisa > 0 ? String(sisa) : "" }));
  };

  const lihatRiwayat = async (id) => {
    try {
      const response = await api.get(`/sahriyah/riwayat/${id}`, {
        params: activeUnitId ? { unit_id: activeUnitId } : readScopeParams,
      });
      setRiwayat(response.data.data);
      setShowRiwayat(true);
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal memuat riwayat"));
    }
  };

  const lihatInvoice = async (invoiceId) => {
    if (!invoiceId) return;
    setShowInvoice(true);
    setIsLoadingInvoice(true);

    try {
      const response = await api.get(`/invoice/sahriyah/${invoiceId}`);
      setInvoice(response.data.data);
    } catch (err) {
      console.error(err);
      setShowInvoice(false);
      alert(getApiError(err, "Gagal memuat invoice"));
    } finally {
      setIsLoadingInvoice(false);
    }
  };

  const tutupInvoice = () => {
    setShowInvoice(false);
    setInvoice(null);
    setIsLoadingInvoice(false);
  };

  const printInvoice = async () => {
    if (!invoice?.invoice_no) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup print diblokir browser");
      return;
    }

    try {
      const response = await api.get(`/invoice/sahriyah/${invoice.invoice_id}/print`, {
        responseType: "text",
      });
      printWindow.document.open();
      printWindow.document.write(response.data);
      printWindow.document.close();
      printWindow.focus();
    } catch (err) {
      console.error(err);
      printWindow.close();
      alert(getApiError(err, "Gagal membuka print invoice"));
    }
  };

  const shareInvoiceWhatsApp = () => {
    const number = invoice?.wali?.whatsapp_number;
    if (!number) {
      alert("Nomor WhatsApp wali belum tersedia");
      return;
    }

    const text = encodeURIComponent(invoice.whatsapp_text || "");
    window.open(`https://wa.me/${number}?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const simpanPembayaran = async () => {
    if (isSavingBayar || !selectedTagihan) return;

    if (isSahriyahLunas(selectedTagihan.status)) {
      alert("Tagihan sahriyah sudah lunas dan tidak dapat dibayar lagi");
      return;
    }

    setIsSavingBayar(true);

    try {
      const response = await api.put(`/sahriyah/bayar/${selectedTagihan.id}`, {
        nominal: Number(formBayar.nominal || 0),
        beras: Number(formBayar.beras || 0),
        petugas: formBayar.petugas,
        ...requireActiveUnitForWrite({ activeUnitId }),
      });

      setShowBayar(false);
      setSelectedTagihan(null);
      setFormBayar({ nominal: "", beras: "", petugas: "" });

      alert("Pembayaran berhasil disimpan");
      await fetchSahriyah(page);
      if (response.data?.invoice_id) {
        await lihatInvoice(response.data.invoice_id);
      }
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Pembayaran gagal"));
    } finally {
      setIsSavingBayar(false);
    }
  };

  const hapusTagihan = async (id) => {
    const yakin = window.confirm("Yakin hapus tagihan sahriyah ini?");
    if (!yakin) return;

    try {
      await api.delete(`/sahriyah/${id}`, { params: { unit_id: activeUnitId } });
      await fetchSahriyah(page);
      alert("Tagihan berhasil dihapus");
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal menghapus tagihan"));
    }
  };

  const handleExport = async () => {
    try {
      const params = buildSahriyahParams({
        bulan,
        tahun,
        search,
        filterStatus,
        filterKelas,
        page: 1,
        limit: 10000,
      });
      Object.assign(params, readScopeParams);

      const response = await api.get("/sahriyah", { params });
      const rows = (response.data.data || []).map((d) => ({
        Nama: d.nama,
        Kamar: d.kamar,
        Tagihan: Number(d.nominal),
        SudahBayar: Number(d.total_bayar),
        Sisa: Number(d.sisa_tagihan),
        Beras: Number(d.nominal_beras),
        BerasMasuk: Number(d.beras_terbayar),
        SisaBeras: Number(d.sisa_beras),
        Status: d.status,
      }));

      exportExcel(rows, "Sahriyah");
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal export sahriyah"));
    }
  };

  const bulanLabel = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ][bulan - 1];

  const pageSize = pagination.limit || DEFAULT_PAGE_SIZE;

  return (
    <AppShell title="Sahriyah" breadcrumb="Keuangan / Sahriyah">
      <KeuanganPageStyles />
      <div className="keuangan-page">
      <Card padding="md" shadow="card" border={false} radius="xl">
        <FilterBar label="Periode" actions={
          <Button onClick={generateTagihan} disabled={isGenerating}>
            {isGenerating ? "Memproses..." : "Generate Tagihan"}
          </Button>
        }>
          <Select value={bulan} onChange={(e) => setBulan(Number(e.target.value))} aria-label="Bulan">
            {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
              <option key={m} value={m}>
                {["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"][m - 1]}
              </option>
            ))}
          </Select>
          <Select value={tahun} onChange={(e) => setTahun(Number(e.target.value))} aria-label="Tahun">
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
            <option value={2028}>2028</option>
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Status">
            <option value="">Semua Status</option>
            <option value="Lunas">Lunas</option>
            <option value="Belum Lunas">Belum Lunas</option>
            <option value="Cicilan">Cicilan</option>
          </Select>
          <Select value={filterKelas} onChange={(e) => setFilterKelas(e.target.value)} aria-label="Kelas">
            <option value="">Semua Kelas</option>
            {kelas.map((k) => (
              <option key={k.id} value={k.id}>{k.nama_kelas}</option>
            ))}
          </Select>
        </FilterBar>
      </Card>

      <div style={{ marginTop: "var(--space-6)" }}>
        <KpiGrid>
          <KpiCard
            label="Total Tagihan"
            value={formatNumber(summary.total || 0)}
            secondaryValue={formatCurrency(summary.total_nominal || 0)}
            accent="primary"
          />
          <KpiCard
            label="Lunas"
            value={formatNumber(summary.lunas || 0)}
            secondaryValue={formatCurrency(summary.lunas_nominal || 0)}
            accent="success"
          />
          <KpiCard
            label="Belum Lunas"
            value={formatNumber(summary.belum_lunas || 0)}
            secondaryValue={formatCurrency(summary.belum_lunas_nominal || 0)}
            trend={Number(summary.partial_count || 0) > 0
              ? `Termasuk ${formatNumber(summary.partial_count)} cicilan`
              : null}
            accent="danger"
          />
          {Number(summary.partial_count || 0) > 0 && (
            <KpiCard
              label="Cicilan (Bagian Belum Lunas)"
              value={formatNumber(summary.partial_count)}
              secondaryValue={`Tagihan ${formatCurrency(summary.partial_nominal_tagihan || 0)}`}
              trend={(
                <>
                  Dibayar {formatCurrency(summary.partial_sudah_dibayar || 0)} · Sisa {formatCurrency(summary.partial_sisa || 0)}
                </>
              )}
              accent="warning"
            />
          )}
        </KpiGrid>
      </div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Data Tagihan Sahriyah"
          subtitle={`Tagihan ${bulanLabel} ${tahun}`}
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {pagination.total || 0} tagihan
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama santri..."
              />
            }
            actions={
              <Button variant="success" onClick={handleExport} disabled={isLoadingTable}>
                Export Excel
              </Button>
            }
          />

          {isLoadingTable ? (
            <EmptyState title="Memuat data..." description="Mohon tunggu sebentar." />
          ) : data.length === 0 ? (
            <EmptyState
              title="Tidak ada tagihan"
              description="Generate tagihan untuk periode ini atau ubah filter pencarian."
            />
          ) : (
            <>
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Kamar / Asrama</th>
                      <th>Tagihan Uang</th>
                      <th>Sudah Bayar</th>
                      <th>Sisa Uang</th>
                      <th>Tagihan Beras</th>
                      <th>Beras Masuk</th>
                      <th>Sisa Beras</th>
                      <th>Status</th>
                      <th>Tgl Bayar</th>
                      <th>Petugas</th>
                      <th className="table-v3__cell--actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((d) => (
                      <tr key={d.id}>
                        <td className="table-v3__cell--strong">{d.nama}</td>
                        <td>{d.kamar || "—"}</td>
                        <td>Rp {Number(d.nominal || 0).toLocaleString()}</td>
                        <td>Rp {Number(d.total_bayar || 0).toLocaleString()}</td>
                        <td>Rp {Number(d.sisa_tagihan || 0).toLocaleString()}</td>
                        <td>{Number(d.nominal_beras || 0)} Kg</td>
                        <td>{Number(d.beras_terbayar || 0)} Kg</td>
                        <td>{Number(d.sisa_beras || 0)} Kg</td>
                        <td>
                          <StatusBadge status={d.status} />
                        </td>
                        <td>{d.tanggal_bayar || "—"}</td>
                        <td>{d.petugas || "—"}</td>
                        <td className="table-v3__cell--actions">
                          <TableActions
                            items={[
                              {
                                type: "custom",
                                icon: FaFileInvoice,
                                title: "Lihat Invoice",
                                hidden: !d.latest_invoice_id,
                                onClick: () => lihatInvoice(d.latest_invoice_id),
                              },
                              {
                                type: "custom",
                                icon: FaMoneyBillWave,
                                title: "Bayar",
                                variant: "success",
                                hidden: isSahriyahLunas(d.status),
                                onClick: () => bayarTagihan(d),
                              },
                              { type: "history", onClick: () => lihatRiwayat(d.id) },
                              { type: "delete", onClick: () => hapusTagihan(d.id) },
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
                totalItems={pagination.total || 0}
                onPageChange={fetchSahriyah}
              />
            </>
          )}
        </DataTableCard>
      </div>

      <Modal open={showBayar} title="Bayar Sahriyah" onClose={tutupBayar} width={480}>
        {selectedTagihan ? (
          <>
            <div className="form-modal-summary-v3">
              <p><strong>Santri:</strong> {selectedTagihan.nama}</p>
              <p><strong>Sisa Uang:</strong> {formatCurrency(selectedTagihan.sisa_tagihan || 0)}</p>
              <p><strong>Sisa Beras:</strong> {Number(selectedTagihan.sisa_beras || 0)} Kg</p>
            </div>
            <FormGrid columns="modal">
              <FormField label="Nominal Uang" htmlFor="sahriyah-nominal">
                <Input
                  id="sahriyah-nominal"
                  type="number"
                  value={formBayar.nominal}
                  onChange={(e) => setFormBayar({ ...formBayar, nominal: e.target.value })}
                  disabled={isSavingBayar}
                />
              </FormField>
              <FormField label="Beras (Kg)" htmlFor="sahriyah-beras">
                <Input
                  id="sahriyah-beras"
                  type="number"
                  value={formBayar.beras}
                  onChange={(e) => setFormBayar({ ...formBayar, beras: e.target.value })}
                  disabled={isSavingBayar}
                />
              </FormField>
              <FormField label="Petugas" htmlFor="sahriyah-petugas">
                <Input
                  id="sahriyah-petugas"
                  value={formBayar.petugas}
                  onChange={(e) => setFormBayar({ ...formBayar, petugas: e.target.value })}
                  disabled={isSavingBayar}
                />
              </FormField>
            </FormGrid>
            <FormActionBar className="form-action-bar-v3--compact">
              <Button variant="secondary" onClick={isiBayarSisaUang} disabled={isSavingBayar || Number(selectedTagihan.sisa_tagihan || 0) <= 0}>
                Bayar Sisa Uang
              </Button>
              <Button variant="secondary" onClick={isiBayarSisaBeras} disabled={isSavingBayar || Number(selectedTagihan.sisa_beras || 0) <= 0}>
                Bayar Sisa Beras
              </Button>
              <Button onClick={simpanPembayaran} disabled={isSavingBayar}>
                {isSavingBayar ? "Menyimpan..." : "Bayar"}
              </Button>
              <Button variant="outline" onClick={tutupBayar} disabled={isSavingBayar}>
                Batal
              </Button>
            </FormActionBar>
          </>
        ) : null}
      </Modal>

      <SahriyahHistoriModal
        open={showRiwayat}
        riwayat={riwayat}
        onClose={() => setShowRiwayat(false)}
        onInvoice={lihatInvoice}
      />
      <SahriyahInvoiceModal
        open={showInvoice}
        invoice={invoice}
        loading={isLoadingInvoice}
        onClose={tutupInvoice}
        onPrint={printInvoice}
        onWhatsApp={shareInvoiceWhatsApp}
      />
      </div>
    </AppShell>
  );
}

export default SahriyahPage;
