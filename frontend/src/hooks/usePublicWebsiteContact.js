import { useWebsiteContent } from "../context/WebsiteContentContext";

const defaultContact = {
  whatsapp: "",
  email: "hello@klikpesantren.com",
  instagram: "https://instagram.com/klikpesantren",
};

export function normalizeWhatsAppNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export function buildWhatsAppUrl(value) {
  const number = normalizeWhatsAppNumber(value);
  return number ? `https://wa.me/${number}` : "";
}

export function usePublicWebsiteContact() {
  const content = useWebsiteContent();
  return { ...defaultContact, ...(content.contact || {}) };
}
