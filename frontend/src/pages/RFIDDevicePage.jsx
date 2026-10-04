import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import {useActiveUnit} from "../context/ActiveUnitContext";
import AttendanceDeviceControls from "../components/AttendanceDeviceControls";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import KpiCard from "../components/ui/KpiCard";
import KpiGrid from "../components/ui/KpiGrid";
import {formatNumber} from "../utils/formatCurrency";

function RFIDDevicePage() {
  const [devices,setDevices]=useState([]),[loadError,setLoadError]=useState("");
  const {activeUnitId,units}=useActiveUnit();
  const requestId=useRef(0),unitRef=useRef(activeUnitId);
  useLayoutEffect(()=>{unitRef.current=activeUnitId;},[activeUnitId]);
  const [deviceUnitId,setDeviceUnitId]=useState(null);
  const scopedDevices=deviceUnitId===activeUnitId ? devices : [];
  const loadData=useCallback(async()=>{
    if(unitRef.current!==activeUnitId)return;
    const id=++requestId.current;
    if(!activeUnitId){setDevices([]);return;}
    try {
      const res=await api.get("/rfid/device/attendance",{params:{unit_id:activeUnitId}});
      if(id===requestId.current && unitRef.current===activeUnitId){setDeviceUnitId(activeUnitId);setDevices(res.data.data||[]);setLoadError("");}
    }catch(err){if(id===requestId.current && unitRef.current===activeUnitId){setDevices([]);setLoadError(err.response?.data?.error || "Gagal memuat perangkat");}}
  },[activeUnitId]);
  useEffect(()=>{
    queueMicrotask(loadData);const interval=setInterval(loadData,10000);
    // Invalidate requests from the previous workspace on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{requestId.current++;clearInterval(interval);};
  },[loadData]);
  return <AppShell title="Perangkat" description="Kelola perangkat yang terhubung ke KlikPesantren." breadcrumb="Sistem / Perangkat">
    {!activeUnitId && <p>Pilih satu unit untuk memuat dan mengelola perangkat.</p>}
    {loadError && <p role="alert">{loadError}</p>}
    <KpiGrid>
      <KpiCard label="Total Perangkat" value={formatNumber(scopedDevices.length)} accent="primary"/>
      <KpiCard label="Online" value={formatNumber(scopedDevices.filter(d=>d.status==="online").length)} accent="success"/>
      <KpiCard label="Offline" value={formatNumber(scopedDevices.filter(d=>d.status!=="online").length)} accent="danger"/>
      <KpiCard label="Sync" value={formatNumber(scopedDevices.filter(d=>d.last_sync).length)} accent="info"/>
    </KpiGrid>
    <AttendanceDeviceControls key={activeUnitId||"none"} unitId={activeUnitId} units={units} devices={scopedDevices} onSaved={loadData}/>
  </AppShell>;
}
export default RFIDDevicePage;
