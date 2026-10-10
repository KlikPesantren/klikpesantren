import { useEffect, useState } from "react";
import api from "../services/api";

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function SubscriptionBillingNotice() {
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    api.get("/dashboard/subscription-billing")
      .then((response) => {
        if (!active) return;
        const data = response.data?.data || null;
        setNotice(data);
        setOpen(Boolean(data?.warning?.show));
      })
      .catch(() => {
        if (active) {
          setNotice(null);
          setOpen(false);
        }
      });
    return () => { active = false; };
  }, []);

  if (!open || !notice?.warning?.show) return null;

  const { subscription, payment, warning } = notice;
  const deadline = subscription.valid_until
    ? new Date(subscription.valid_until).toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "-";
  const hasPaymentDetails = Boolean(
    payment.bank_name
      || payment.account_number
      || payment.account_holder
      || payment.instruction,
  );

  const copyAccount = async () => {
    if (!payment.account_number) return;
    await navigator.clipboard.writeText(payment.account_number);
    setCopied(true);
  };

  return (
    <div style={overlayStyle} role="presentation">
      <section style={dialogStyle} role="dialog" aria-modal="true" aria-labelledby="billing-warning-title">
        <button type="button" onClick={() => setOpen(false)} style={closeStyle} aria-label="Tutup">
          ×
        </button>
        <p style={eyebrowStyle}>{warning.urgent ? "JATUH TEMPO HARI INI" : "PENGINGAT LANGGANAN"}</p>
        <h2 id="billing-warning-title" style={titleStyle}>Pembayaran Langganan</h2>
        <p style={messageStyle}>
          Masa aktif berakhir pada <strong>{deadline}</strong>
          {warning.urgent
            ? ". Layanan masih aktif sampai akhir hari ini."
            : ` (${subscription.days_until_due} hari lagi).`}
        </p>
        <div style={amountStyle}>
          <span>Nominal</span>
          <strong>{subscription.amount == null ? "Belum ditetapkan" : rupiah.format(subscription.amount)}</strong>
        </div>
        {hasPaymentDetails ? (
          <div style={paymentStyle}>
            {payment.bank_name ? <p><span>Bank</span><strong>{payment.bank_name}</strong></p> : null}
            {payment.account_number ? (
              <p>
                <span>No. Rekening</span>
                <strong>{payment.account_number}</strong>
                <button type="button" onClick={copyAccount} style={copyStyle}>
                  {copied ? "Tersalin" : "Salin"}
                </button>
              </p>
            ) : null}
            {payment.account_holder ? <p><span>a.n.</span><strong>{payment.account_holder}</strong></p> : null}
            {payment.instruction ? <div style={instructionStyle}>{payment.instruction}</div> : null}
          </div>
        ) : null}
        <div style={actionsStyle}>
          <button type="button" onClick={() => setOpen(false)} style={secondaryStyle}>Nanti</button>
          {payment.confirmation_url ? (
            <a href={payment.confirmation_url} target="_blank" rel="noreferrer" style={primaryStyle}>
              Konfirmasi Pembayaran
            </a>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const overlayStyle = { position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,23,42,.56)", display: "grid", placeItems: "center", padding: 18 };
const dialogStyle = { position: "relative", width: "min(100%, 520px)", borderRadius: 18, background: "var(--surface)", color: "var(--text-primary)", padding: 24, boxShadow: "0 24px 80px rgba(15,23,42,.3)" };
const closeStyle = { position: "absolute", top: 12, right: 14, border: 0, background: "transparent", fontSize: 28, cursor: "pointer", color: "var(--text-secondary)" };
const eyebrowStyle = { margin: "0 0 6px", color: "var(--warning, #b45309)", fontWeight: 800, fontSize: 12, letterSpacing: ".08em" };
const titleStyle = { margin: "0 0 10px", fontSize: 24 };
const messageStyle = { margin: "0 0 16px", lineHeight: 1.6, color: "var(--text-secondary)" };
const amountStyle = { display: "flex", justifyContent: "space-between", gap: 16, padding: "14px 16px", borderRadius: 12, background: "var(--surface-muted)", marginBottom: 14 };
const paymentStyle = { display: "grid", gap: 8, padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 12 };
const instructionStyle = { whiteSpace: "pre-wrap", marginTop: 4, color: "var(--text-secondary)", fontSize: 13 };
const copyStyle = { marginLeft: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", background: "var(--surface)", cursor: "pointer" };
const actionsStyle = { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" };
const secondaryStyle = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", background: "var(--surface)", cursor: "pointer", fontWeight: 700 };
const primaryStyle = { borderRadius: 10, padding: "10px 14px", background: "var(--primary)", color: "#fff", textDecoration: "none", fontWeight: 800 };

export default SubscriptionBillingNotice;
