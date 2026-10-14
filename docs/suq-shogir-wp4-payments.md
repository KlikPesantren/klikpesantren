# Suq Shogir WP4 payment boundaries

## Payment authority

- Cash is accepted only inside an active shift and is posted to that shift's validated cash account.
- Bank transfer and QRIS use merchant-owned destination accounts. In WP4 they require an explicit, permission-controlled manual confirmation plus a unique evidence reference.
- No QRIS provider is configured. A QR/reference value alone is never proof of payment and never marks a sale paid.
- Dompet Santri remains owned by KlikPesantren. Suq Shogir can submit an authorized sale debit or refund the original debit; it cannot top up or withdraw funds.
- Wallet-funded sales remain linked to canonical merchant settlement obligations.

## Card credentials

- Printed card barcodes contain only the existing opaque `kpw_` credential. They never contain a balance, PIN, santri identifier, or other private wallet data.
- NFC reads the local tag identifier and serializes it as lowercase hexadecimal while preserving byte order and leading zeroes, matching the canonical RFID lookup contract.
- A scan is only identification input. The backend still authenticates the operator and enforces tenant, merchant, unit, feature, balance, and replay/idempotency rules before debit.
- Raw credentials are not logged or displayed by the application. Wallet payments fail closed when offline.

## Runtime acceptance gates

- Camera barcode reading must be verified on a real Android device using a synthetic/test card.
- NFC support must be verified against the actual deployed card technology and Android handset. Library support for NFC-A does not prove compatibility with every RFID card.
- Automatic QRIS confirmation remains blocked until a provider and authenticated verification/callback contract are approved and configured.
- Any native dependency change requires a fresh Android build; Expo Go is not sufficient for the NFC module.
