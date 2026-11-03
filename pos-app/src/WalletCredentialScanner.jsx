import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, Pressable, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { AppText as Text } from "./typography";
import { Button, Icon, colors, s } from "./ui";
const { scanResult } = require("./paymentCredential.cjs");
const { nfcFailureMessage, nfcStatusMessage } = require("./nfcFeedback.cjs");

export function WalletCredentialScanner({ disabled, disabledReason, onScan, scanContext = "" }) {
  const [camera, setCamera] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("READY");
  const accepted = useRef(false);
  const scanSequence = useRef(0);
  const requested = useRef(false);
  const cancelBarrier = useRef(Promise.resolve());

  const cancelNfc = useCallback(async (cancelled = false) => {
    scanSequence.current += 1;
    if (requested.current) {
      requested.current = false;
      const cleanup=(async()=>{try { const module = await import("react-native-nfc-manager"); await module.default.cancelTechnologyRequest(); } catch { /* cleanup only */ }})();
      cancelBarrier.current=cleanup;await cleanup;
    }
    requested.current = false;
    setBusy(false);setStatus("READY");
    if (cancelled) { setStatus("READY"); setMessage(nfcFailureMessage(Error("NFC_CANCELLED"), "READ").message); }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => { if (next !== "active") void cancelNfc(false); });
    return () => { subscription.remove(); void cancelNfc(false); };
  }, [cancelNfc]);

  useEffect(()=>{let alive=true;(async()=>{await cancelNfc(false);if(alive){setCamera(false);accepted.current=false;setStatus("READY");setMessage("");}})();return()=>{alive=false;};},[disabled,scanContext,cancelNfc]);

  async function openCamera() {
    if(disabled)return;
    const cancellation=cancelNfc(false),sequence=scanSequence.current;
    await cancellation;if(sequence!==scanSequence.current)return;
    setMessage(""); setStatus("READY");
    const result = permission?.granted ? permission : await requestPermission();
    if(sequence!==scanSequence.current)return;
    if (!result?.granted) return setMessage("Izin kamera diperlukan untuk memindai barcode kartu.");
    accepted.current = false;
    setCamera(true);
  }

  async function acceptBarcode(event) {
    if (accepted.current || disabled || !camera) return;
    const sequence=scanSequence.current;
    accepted.current = true;
    try {
      const method = event.type === "qr" ? "QR" : "BARCODE";
      setStatus("VERIFYING");
      await onScan(scanResult(method, event.data),()=>sequence===scanSequence.current);
      if(sequence!==scanSequence.current)return;
      setStatus("VERIFIED");
      setCamera(false);
    } catch (error) {
      if(sequence!==scanSequence.current)return;
      accepted.current = false;
      setStatus("READY");
      setMessage(nfcFailureMessage(error, "PREVIEW").message || "Barcode tidak dapat digunakan.");
    }
  }

  async function scanNfc() {
    if (busy || disabled || Platform.OS !== "android") return;
    const queuedAt=scanSequence.current;await cancelBarrier.current;
    if(queuedAt!==scanSequence.current)return;
    const sequence = ++scanSequence.current;
    setBusy(true); setMessage(""); setStatus("WAITING");
    let phase = "SETUP",timer;
    try {
      const module = await import("react-native-nfc-manager");
      const manager = module.default, tech = module.NfcTech;
      if(sequence!==scanSequence.current)return;
      await manager.start();
      if(sequence!==scanSequence.current)return;
      if (!(await manager.isSupported(tech.NfcA))) throw Error("NFC_UNAVAILABLE");
      if (!(await manager.isEnabled())) throw Error("NFC_DISABLED");
      if(sequence!==scanSequence.current)return;
      requested.current = true;
      phase = "READ";
      await Promise.race([
        manager.requestTechnology(tech.NfcA),
        new Promise((_, reject) => {timer=setTimeout(() => reject(Object.assign(Error("NFC_TIMEOUT"), { code: "NFC_TIMEOUT" })), 20000);}),
      ]);
      if (sequence !== scanSequence.current) return;
      const tag = await manager.getTag();
      if(sequence!==scanSequence.current)return;
      setStatus("DETECTED");
      phase = "PREVIEW";
      setStatus("VERIFYING");
      await onScan(scanResult("RFID", tag?.id),()=>sequence===scanSequence.current);
      if (sequence === scanSequence.current) setStatus("VERIFIED");
    } catch (error) {
      if (sequence === scanSequence.current) { setStatus("READY"); setMessage(nfcFailureMessage(error, phase).message); }
    } finally {
      clearTimeout(timer);
      if (sequence===scanSequence.current && requested.current) {
        try { const module = await import("react-native-nfc-manager"); await module.default.cancelTechnologyRequest(); } catch { /* cleanup only */ }
      }
      if (sequence === scanSequence.current) {requested.current=false;setBusy(false); }
    }
  }

  return <View style={s.sectionCompact}>
    <Text style={s.muted}>Credential hanya dipakai untuk preview online dan debit atomic. UID/token tidak ditampilkan atau dicatat.</Text>
    <View style={status === "VERIFIED" ? s.alertSuccess : s.scannerStatus}><Text style={status === "VERIFIED" ? s.success : s.text}>{nfcStatusMessage(status)}</Text></View>
    {disabled && !!disabledReason && <View style={s.alertError}><Text style={s.error}>{disabledReason}</Text></View>}
    <View style={s.actionRow}>
      <Button title="Pindai Barcode / QR" secondary icon="camera" disabled={disabled || busy} disabledHint={disabled ? disabledReason : undefined} onPress={openCamera}/>
      <Button title={busy ? "Batalkan NFC" : "Baca NFC"} secondary icon="radio" disabled={disabled || Platform.OS !== "android"} disabledHint={disabled ? disabledReason : Platform.OS !== "android" ? "NFC memerlukan aplikasi Android native pada perangkat yang mendukung NFC." : undefined} onPress={busy ? () => cancelNfc(true) : scanNfc}/>
    </View>
    {Platform.OS === "web" && <Text style={s.muted}>NFC hanya tersedia pada build Android native.</Text>}
    {!!message && <Text style={s.error}>{message}</Text>}
    <Modal visible={camera} animationType="slide" onRequestClose={()=>{setCamera(false);void cancelNfc(false);}}>
      <View style={s.scannerRoot}>
        <CameraView style={s.scannerCamera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13"] }} onBarcodeScanned={acceptBarcode}/>
        <View style={s.scannerPanel}><Icon name="maximize" size={24} color={colors.surface}/><Text style={s.scannerText}>Arahkan kamera ke barcode kartu Dompet Santri.</Text><Pressable style={s.scannerClose} onPress={()=>{setCamera(false);void cancelNfc(false);}}><Text style={s.scannerCloseText}>Batal</Text></Pressable></View>
      </View>
    </Modal>
  </View>;
}
