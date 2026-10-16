import React, { useRef, useState } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { AppText as Text } from "./typography";
import { Button, Icon, colors, s } from "./ui";
const { scanResult } = require("./paymentCredential.cjs");

export function WalletCredentialScanner({ disabled, disabledReason, onScan }) {
  const [camera, setCamera] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const accepted = useRef(false);

  async function openCamera() {
    setMessage("");
    const result = permission?.granted ? permission : await requestPermission();
    if (!result?.granted) return setMessage("Izin kamera diperlukan untuk memindai barcode kartu.");
    accepted.current = false;
    setCamera(true);
  }

  async function acceptBarcode(event) {
    if (accepted.current) return;
    accepted.current = true;
    try {
      const method = event.type === "qr" ? "QR" : "BARCODE";
      await onScan(scanResult(method, event.data));
      setCamera(false);
    } catch (error) {
      accepted.current = false;
      setMessage(error.message === "UNKNOWN_CREDENTIAL"
        ? "Barcode bukan credential Dompet Santri yang valid."
        : error.message === "WALLET_PREVIEW_FAILED"
          ? "Credential terbaca, tetapi preview Dompet ditolak. Lihat alasan akses di atas lalu perbaiki sebelum mencoba lagi."
          : "Barcode tidak dapat digunakan.");
    }
  }

  async function scanNfc() {
    if (busy || Platform.OS !== "android") return;
    setBusy(true); setMessage("");
    let requested = false;
    try {
      const module = await import("react-native-nfc-manager");
      const manager = module.default, tech = module.NfcTech;
      await manager.start();
      if (!(await manager.isSupported(tech.NfcA))) throw Error("NFC_UNAVAILABLE");
      requested = true;
      await manager.requestTechnology(tech.NfcA);
      const tag = await manager.getTag();
      await onScan(scanResult("RFID", tag?.id));
    } catch (error) {
      setMessage(error.message === "UNSUPPORTED_NFC_TAG"
        ? "Tag terbaca, tetapi UID tidak sesuai format kartu RFID KlikPesantren."
        : error.message === "WALLET_PREVIEW_FAILED"
          ? "Kartu terbaca, tetapi preview Dompet ditolak. Lihat alasan akses di atas lalu perbaiki sebelum mencoba lagi."
          : "NFC tidak tersedia atau pemindaian dibatalkan.");
    } finally {
      if (requested) {
        try { const module = await import("react-native-nfc-manager"); await module.default.cancelTechnologyRequest(); } catch { /* cleanup only */ }
      }
      setBusy(false);
    }
  }

  return <View style={s.sectionCompact}>
    <Text style={s.muted}>Credential hanya dipakai untuk preview online dan debit atomic. UID/token tidak ditampilkan atau dicatat.</Text>
    {disabled && !!disabledReason && <View style={s.alertError}><Text style={s.error}>{disabledReason}</Text></View>}
    <View style={s.actionRow}>
      <Button title="Pindai Barcode / QR" secondary icon="camera" disabled={disabled || busy} disabledHint={disabled ? disabledReason : undefined} onPress={openCamera}/>
      <Button title={busy ? "Tempelkan kartu…" : "Baca NFC"} secondary icon="radio" disabled={disabled || busy || Platform.OS !== "android"} disabledHint={disabled ? disabledReason : Platform.OS !== "android" ? "NFC memerlukan aplikasi Android native pada perangkat yang mendukung NFC." : undefined} onPress={scanNfc}/>
    </View>
    {Platform.OS === "web" && <Text style={s.muted}>NFC hanya tersedia pada build Android native.</Text>}
    {!!message && <Text style={s.error}>{message}</Text>}
    <Modal visible={camera} animationType="slide" onRequestClose={() => setCamera(false)}>
      <View style={s.scannerRoot}>
        <CameraView style={s.scannerCamera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13"] }} onBarcodeScanned={acceptBarcode}/>
        <View style={s.scannerPanel}><Icon name="maximize" size={24} color={colors.surface}/><Text style={s.scannerText}>Arahkan kamera ke barcode kartu Dompet Santri.</Text><Pressable style={s.scannerClose} onPress={() => setCamera(false)}><Text style={s.scannerCloseText}>Batal</Text></Pressable></View>
      </View>
    </Modal>
  </View>;
}
