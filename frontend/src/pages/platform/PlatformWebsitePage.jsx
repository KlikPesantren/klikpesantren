import { useCallback, useEffect, useState } from "react";
import platformApi from "../../services/platformApi";
import PlatformButton from "../../components/platform/PlatformButton";
import WebsiteAssetField from "../../components/platform/WebsiteAssetField";

const DEFAULT_CONTENT = {
  brand: {
    website_name: "KlikPesantren",
    tagline: "Platform administrasi pesantren modern",
    whatsapp: "6281383919797",
    email: "hello@klikpesantren.com",
    instagram: "https://instagram.com/klikpesantren",
    logo_url: "/landing/logo.png",
  },
  navigation: {
    items: [
      { label: "Fitur", to: "/fitur", enabled: true },
      { label: "Harga", to: "/harga", enabled: true },
      { label: "Demo", to: "/demo", enabled: true },
      { label: "Founding Partner", to: "/founding-partner", enabled: true, campaign: true },
      { label: "Tentang", to: "/tentang", enabled: true },
      { label: "Blog", to: "/blog", enabled: true },
      { label: "Kontak", to: "/kontak", enabled: true },
    ],
    primary_cta_label: "Minta Demo",
    primary_cta_url: "/demo",
    campaign_cta_label: "Founding Partner",
    campaign_cta_url: "/founding-partner",
  },
  seo: {
    default_title: "KlikPesantren | Platform SaaS Operasional Pesantren Modern",
    default_description:
      "KlikPesantren membantu pesantren mengelola administrasi santri, keuangan, Wali Santri App, RFID, perizinan, pelanggaran, dan dashboard operasional.",
    canonical_base_url: "https://klikpesantren.com",
    og_image_url: "https://klikpesantren.com/landing/dashboard-admin.png",
  },
  homepage: {
    hero_title: "Platform SaaS untuk Operasional Pesantren Modern",
    hero_subtitle:
      "KlikPesantren membantu pesantren mengelola administrasi santri, keuangan, wali santri, RFID, perizinan, pelanggaran, dan dashboard operasional dalam satu sistem terintegrasi.",
    primary_cta_label: "Minta Demo",
    primary_cta_url: "/demo",
    secondary_cta_label: "Daftar Founding Partner",
    secondary_cta_url: "/founding-partner",
    hero: {
      eyebrow: "SaaS operasional pesantren",
      title: "Platform SaaS untuk Operasional Pesantren Modern",
      subtitle: "KlikPesantren membantu pesantren mengelola administrasi santri, keuangan, wali santri, RFID, perizinan, pelanggaran, dan dashboard operasional dalam satu sistem terintegrasi.",
      primary_cta_label: "Minta Demo",
      primary_cta_url: "/demo",
      secondary_cta_enabled: true,
      secondary_cta_label: "Daftar Founding Partner",
      secondary_cta_url: "/founding-partner",
      image_url: "/landing/dashboard-admin.png",
    },
    sections: {
      proof: { enabled: true, eyebrow: "Product Proof", title: "Satu ekosistem untuk kerja harian pesantren.", description: "KlikPesantren menghubungkan tim internal pesantren, wali santri, dan perangkat operasional dalam alur yang lebih rapi.", items: [
        { title: "Web Admin", text: "Pusat kerja operator dan pengurus untuk data, tagihan, laporan, dan kontrol operasional." },
        { title: "Wali Santri App", text: "Akses informasi anak, pengumuman, tagihan, dan notifikasi penting untuk wali santri." },
        { title: "RFID", text: "Kartu santri, saldo, limit harian, topup, refund, dan riwayat transaksi yang terpantau." },
        { title: "Multi Tenant", text: "Satu platform untuk banyak pesantren dengan data, fitur, dan akses yang terpisah." },
      ] },
      problems: { enabled: true, eyebrow: "Problem", title: "Operasional pesantren sering berat karena informasi tersebar.", description: "Banyak pekerjaan penting berjalan paralel setiap hari. Ketika data, transaksi, dan komunikasi tidak berada di satu sistem, keputusan menjadi lebih lambat.", items: ["Data santri, wali, kelas, dan status administrasi masih tersebar di banyak tempat.", "Pembayaran, perizinan, pelanggaran, dan RFID sulit dipantau secara cepat.", "Wali santri menunggu informasi karena komunikasi belum terhubung ke sistem.", "Pimpinan membutuhkan ringkasan operasional tanpa menambah beban operator."] },
      solution: { enabled: true, eyebrow: "Solution", title: "Platform SaaS yang mengikuti cara kerja pesantren.", description: "Bukan website sekolah dan bukan profil yayasan. KlikPesantren adalah produk operasional untuk pengurus, operator, bendahara, pimpinan, dan wali santri.", panel_title: "Dari pencatatan tersebar menjadi sistem kerja terintegrasi.", panel_description: "KlikPesantren membantu pesantren memulai digitalisasi secara bertahap, dari data santri dan pembayaran sampai app wali, RFID, dan dashboard pimpinan.", cta_label: "Lihat Fitur", cta_url: "/fitur" },
      features: { enabled: true, eyebrow: "Fitur Utama", title: "Modul inti untuk operasional pesantren modern.", description: "Fitur disusun dari kebutuhan produk yang sudah ada agar pesantren bisa mulai dari administrasi dasar dan berkembang bertahap.", items: [
        { title: "Administrasi Santri", text: "Data santri, wali, kelas, status, dan riwayat penting dalam satu pusat data." },
        { title: "Keuangan Pesantren", text: "Tagihan, pembayaran, sahriyah, buku kas, kwitansi, dan laporan keuangan." },
        { title: "RFID", text: "Transaksi kartu santri, merchant, topup, refund, limit, dan audit mutasi." },
        { title: "Wali Santri App", text: "Aplikasi wali untuk memantau kabar anak, tagihan, pengumuman, dan notifikasi." },
        { title: "Perizinan", text: "Pengajuan, approval, dan monitoring izin santri dengan status yang jelas." },
        { title: "Pelanggaran", text: "Catatan kedisiplinan, pembinaan, dan rekap pelanggaran per periode." },
        { title: "Dashboard", text: "Ringkasan operasional, keuangan, akademik, dan kedisiplinan untuk pimpinan." },
        { title: "Multi Tenant", text: "Arsitektur SaaS untuk banyak pesantren dengan ruang data yang terpisah." },
      ] },
      preview: { enabled: true, eyebrow: "Product Preview", title: "Web admin dan aplikasi wali dalam satu alur operasional.", description: "Dashboard membantu tim internal memantau pekerjaan, sementara aplikasi wali menjaga informasi tetap sampai ke orang tua.", admin_image_url: "/landing/dashboard-admin.png", wali_image_url: "/landing/wali-app.png" },
      reasons: { enabled: true, eyebrow: "Why KlikPesantren", title: "Dibangun sebagai produk SaaS, bukan sekadar halaman profil.", items: ["Modular, sehingga pesantren bisa mulai dari kebutuhan paling mendesak.", "Dirancang untuk kerja harian operator, pengurus, bendahara, dan pimpinan.", "Menghubungkan web admin, app wali, RFID, dan dashboard dalam satu ekosistem.", "Siap berkembang dari satu unit operasional menuju banyak tenant dan unit."] },
      pricing_teaser: { enabled: true, title: "Paket dibuat bertahap sesuai kebutuhan pesantren.", description: "Mulai dari modul dasar, lalu berkembang ke perizinan, pelanggaran, sahriyah, RFID, Wali App, dan kebutuhan custom.", cta_label: "Lihat Harga", cta_url: "/harga" },
      campaign_teaser: { enabled: true, title: "Program Founding Partner tetap tersedia.", description: "Campaign lama dipertahankan untuk pesantren yang ingin ikut fase awal dan mendapatkan pendampingan prioritas.", cta_label: "Daftar Founding Partner", cta_url: "/founding-partner" },
      final_cta: { enabled: true, title: "Siap melihat bagaimana KlikPesantren bekerja untuk operasional harian?", description: "Jadwalkan demo untuk melihat alur admin, keuangan, RFID, app wali, dan dashboard sesuai kebutuhan pesantren.", primary_label: "Minta Demo", primary_url: "/demo", secondary_label: "Daftar Founding Partner", secondary_url: "/founding-partner" },
    },
  },
  pages: {
    features: { hero: { eyebrow: "Fitur", title: "Fitur lengkap untuk operasional pesantren modern.", text: "KlikPesantren menyatukan operasional pesantren dalam satu platform SaaS." }, items: [
      { title: "Administrasi Santri", summary: "Pusat data santri, wali, kelas, status, dan riwayat penting.", points: ["Profil santri dan wali dalam satu tempat", "Data kelas, status, dan informasi operasional", "Fondasi data untuk modul pembayaran, izin, dan laporan"] },
      { title: "Keuangan Pesantren", summary: "Kelola tagihan, sahriyah, pembayaran, buku kas, dan laporan.", points: ["Tagihan dan pembayaran lebih mudah dilacak", "Kwitansi dan histori pembayaran digital", "Buku kas dan ringkasan keuangan untuk pengurus"] },
      { title: "RFID", summary: "Transaksi kartu santri, saldo, limit, merchant, dan audit mutasi.", points: ["Topup, refund, dan mutasi saldo RFID", "Kontrol limit dan riwayat transaksi santri", "Monitoring perangkat dan merchant RFID"] },
      { title: "Wali Santri App", summary: "Aplikasi wali untuk informasi anak, tagihan, dan pengumuman.", points: ["Informasi anak terhubung dari sistem pesantren", "Pengumuman dan notifikasi penting", "Akses tagihan dan riwayat pembayaran"] },
      { title: "Perizinan", summary: "Alur pengajuan, approval, dan monitoring izin santri.", points: ["Status izin lebih jelas untuk pengurus", "Riwayat izin santri terdokumentasi", "Membantu kontrol keluar masuk santri"] },
      { title: "Pelanggaran", summary: "Catatan kedisiplinan, pembinaan, dan rekap pelanggaran.", points: ["Riwayat pelanggaran santri per periode", "Data pembinaan lebih mudah ditinjau", "Rekap untuk pengurus dan pimpinan"] },
      { title: "Dashboard", summary: "Ringkasan operasional untuk operator, pengurus, dan pimpinan.", points: ["Pantauan data penting dalam satu tampilan", "Ringkasan operasional dan keuangan", "Membantu keputusan lebih cepat"] },
      { title: "Multi Tenant", summary: "Arsitektur SaaS untuk banyak pesantren dengan data terpisah.", points: ["Data dan akses dipisahkan per pesantren", "Fitur dapat diaktifkan sesuai paket", "Siap untuk pengelolaan banyak tenant"] },
    ] },
    pricing: { hero: { eyebrow: "Harga", title: "Paket bertahap sesuai kesiapan operasional pesantren.", text: "Harga final disesuaikan setelah sesi demo dan pemetaan kebutuhan." }, plans: [
      { name: "Basic", label: "Operasional dasar", text: "Untuk pesantren yang ingin merapikan data inti dan komunikasi awal.", features: ["Dashboard", "Profil pesantren", "Administrasi santri", "Guru, kelas, wali", "Pembayaran dasar", "Pengumuman"] },
      { name: "Standard", label: "Administrasi terhubung", text: "Untuk tim yang ingin mengelola administrasi dan pengawasan harian lebih rapi.", features: ["Semua fitur Basic", "Perizinan", "Pelanggaran", "Sahriyah", "Rekap operasional"] },
      { name: "Premium", label: "Ekosistem penuh", text: "Untuk pesantren yang membutuhkan RFID, app wali, dan kontrol operasional lebih lengkap.", features: ["Semua fitur Standard", "RFID", "Wali Santri App", "Kas instansi", "Audit", "Program unit"] },
      { name: "Custom", label: "Kebutuhan khusus", text: "Untuk pesantren atau jaringan lembaga yang membutuhkan konfigurasi fitur khusus.", features: ["Pilihan fitur manual", "Kebutuhan multi unit", "Pendampingan scope", "Roadmap implementasi khusus"] },
    ], campaign_banner: { enabled: true, title: "Slot Founding Partner masih menjadi jalur khusus.", text: "Untuk pesantren yang ingin ikut fase awal, campaign Founding Partner tetap tersedia dengan pendampingan prioritas.", cta_label: "Lihat Founding Partner" } },
    demo: { hero: { eyebrow: "Minta Demo", title: "Lihat bagaimana KlikPesantren bekerja untuk pesantren Anda.", text: "Isi form singkat ini untuk diarahkan ke WhatsApp." } },
    about: { hero: { eyebrow: "Tentang KlikPesantren", title: "Platform digitalisasi pesantren yang lahir dari kebutuhan operasional nyata.", text: "KlikPesantren dibangun untuk membantu pesantren bekerja lebih rapi, cepat, dan terukur." }, story_title: "Cerita produk", story_paragraphs: ["Banyak pesantren telah berkembang cepat, tetapi pekerjaan administrasi masih sering bergantung pada proses manual.", "KlikPesantren hadir sebagai platform SaaS yang menyatukan pekerjaan tersebut dalam satu ekosistem."], principles: [{ title: "Visi", text: "Membantu pesantren memiliki sistem operasional digital yang rapi, aman, dan mudah berkembang." }, { title: "Misi", text: "Menyediakan modul yang dapat diimplementasikan bertahap." }, { title: "Prinsip produk", text: "Modular, mudah digunakan operator, siap multi tenant, dan berorientasi pada kebutuhan lapangan." }] },
    contact: { hero: { eyebrow: "Kontak", title: "Hubungi tim KlikPesantren.", text: "Pilih jalur komunikasi yang paling nyaman." }, whatsapp_text: "Jalur tercepat untuk bertanya, menjadwalkan demo, atau membahas kebutuhan awal.", email_text: "Gunakan email untuk kebutuhan resmi, proposal, atau komunikasi tertulis.", instagram_text: "Kanal sosial untuk update produk, edukasi digitalisasi pesantren, dan informasi campaign.", closing: { enabled: true, title: "Butuh arahan paket yang cocok?", text: "Mulai dari demo singkat. Tim KlikPesantren akan membantu memetakan kebutuhan fitur dan tahap implementasi.", cta_label: "Minta Demo" } },
    blog: { enabled: true, hero: { eyebrow: "Blog", title: "Insight digitalisasi pesantren.", text: "Edukasi operasional pesantren." }, posts: [
      { title: "Checklist Digitalisasi Administrasi Pesantren", category: "Administrasi", text: "Tahapan awal merapikan data santri, wali, kelas, dan alur operasional sebelum masuk ke modul lanjutan." },
      { title: "Mengapa Keuangan Pesantren Perlu Sistem Terpusat", category: "Keuangan", text: "Cara melihat tagihan, pembayaran, dan laporan agar bendahara dan pimpinan punya data yang sama." },
      { title: "Peran Wali Santri App dalam Komunikasi Pesantren", category: "Wali Santri", text: "Bagaimana aplikasi wali membantu pengumuman, tagihan, dan informasi anak sampai lebih cepat." },
    ] },
  },
  campaign: {
    enabled: true,
    nav_label: "Founding Partner",
    page: {
      seo_title: "Founding Partner KlikPesantren | Program 5 Pesantren Awal",
      seo_description: "Program Founding Partner KlikPesantren untuk pesantren yang ingin ikut fase awal digitalisasi.",
      hero_badge: "Platform administrasi pesantren modern",
      hero_title: "Digitalisasi Pesantren Dimulai dari Sini",
      hero_description: "KlikPesantren adalah platform administrasi pesantren modern dalam satu ekosistem SaaS.",
      hero_cta_label: "Daftar Founding Partner",
      secondary_cta_label: "Lihat Gambaran Sistem",
      hero_image_url: "/landing/dashboard-admin.png",
      founding: { enabled: true, eyebrow: "Program Terbatas", title: "Founding Partner KlikPesantren untuk 5 pesantren pertama.", description: "Kolaborasi awal untuk membangun sistem yang cocok dengan kebutuhan lapangan.", quota: "5", quota_text: "slot pesantren pertama untuk fase Founding Partner.", cta_label: "Ambil Slot Founding Partner" },
      benefits: { enabled: true, eyebrow: "Benefit Founding Partner", title: "Lebih dekat dengan tim produk, lebih awal merasakan manfaatnya.", items: ["Harga khusus Founding Partner selama periode awal.", "Prioritas onboarding dan pendampingan setup data.", "Masukan pesantren ikut membentuk roadmap produk KlikPesantren.", "Akses lebih awal ke modul baru yang relevan.", "Badge Founding Partner untuk profil pesantren."] },
      pricing: { enabled: true, eyebrow: "Paket", title: "Mulai sesuai kebutuhan, berkembang bersama operasional pesantren.", description: "Penawaran khusus setelah sesi konsultasi kebutuhan.", partner_price: "Khusus 5 awal" },
      faqs: { enabled: true, eyebrow: "FAQ", title: "Pertanyaan yang sering muncul sebelum mulai.", items: [
        { question: "Apakah KlikPesantren cocok untuk pesantren kecil?", answer: "Cocok. Sistem dibuat bertahap, jadi pesantren bisa mulai dari data santri, pembayaran, dan aplikasi wali dulu." },
        { question: "Apakah harus langsung memakai semua modul?", answer: "Tidak. Modul bisa diaktifkan sesuai kebutuhan operasional pesantren." },
        { question: "Apakah data pesantren dipisah antar lembaga?", answer: "Ya. KlikPesantren dirancang multi-tenant sehingga setiap pesantren memiliki ruang data masing-masing." },
        { question: "Bagaimana cara daftar Founding Partner?", answer: "Klik tombol WhatsApp, lalu tim KlikPesantren akan membantu cek kebutuhan dan jadwal onboarding." },
      ] },
      final_cta: { enabled: true, title: "Siap jadi salah satu dari 5 Founding Partner KlikPesantren?", description: "Ceritakan kebutuhan pesantren kepada tim KlikPesantren.", cta_label: "Hubungi via WhatsApp" },
    },
  },
  contact: {
    whatsapp: "6281383919797",
    email: "hello@klikpesantren.com",
    instagram: "https://instagram.com/klikpesantren",
  },
  footer: {
    description: "Platform SaaS untuk membantu pesantren mengelola administrasi, keuangan, komunikasi wali, dan operasional harian dalam satu sistem terintegrasi.",
    product_title: "Produk", company_title: "Perusahaan",
    copyright: "© 2026 KlikPesantren. Platform administrasi pesantren modern.",
  },
};

const sections = [
  {
    title: "Brand",
    description: "Identitas dasar website resmi KlikPesantren.",
    fields: [
      { path: "brand.website_name", label: "Website Name" },
      { path: "brand.tagline", label: "Tagline" },
      { path: "brand.logo_url", label: "Logo", type: "asset" },
    ],
  },
  {
    title: "Navigasi & Header",
    description: "CTA global dan label campaign pada navigasi public.",
    fields: [
      { path: "navigation.primary_cta_label", label: "Primary CTA Label" },
      { path: "navigation.primary_cta_url", label: "Primary CTA URL" },
      { path: "navigation.campaign_cta_label", label: "Campaign CTA Label" },
      { path: "navigation.campaign_cta_url", label: "Campaign CTA URL" },
      ...DEFAULT_CONTENT.navigation.items.flatMap((item, index) => [
        { path: `navigation.items.${index}.enabled`, label: `${item.label} tampil`, type: "checkbox" },
        { path: `navigation.items.${index}.label`, label: `${item.label} — Label` },
        { path: `navigation.items.${index}.to`, label: `${item.label} — URL` },
      ]),
    ],
  },
  {
    title: "Homepage Hero",
    description: "Konten utama yang tampil pertama kali di halaman beranda.",
    fields: [
      { path: "homepage.hero.eyebrow", label: "Eyebrow" },
      { path: "homepage.hero.title", label: "Hero Title" },
      { path: "homepage.hero.subtitle", label: "Hero Subtitle", type: "textarea" },
      { path: "homepage.hero.image_url", label: "Hero Image", type: "asset" },
    ],
  },
  {
    title: "CTA",
    description: "Tombol utama dan sekunder di homepage.",
    fields: [
      { path: "homepage.hero.primary_cta_label", label: "Primary CTA Label" },
      { path: "homepage.hero.primary_cta_url", label: "Primary CTA URL" },
      { path: "homepage.hero.secondary_cta_enabled", label: "Secondary CTA tampil", type: "checkbox" },
      { path: "homepage.hero.secondary_cta_label", label: "Secondary CTA Label" },
      { path: "homepage.hero.secondary_cta_url", label: "Secondary CTA URL" },
    ],
  },
  {
    title: "Homepage Sections",
    description: "Tampilkan atau sembunyikan section marketing homepage.",
    fields: [
      { path: "homepage.sections.proof.enabled", label: "Product Proof", type: "checkbox" },
      { path: "homepage.sections.problems.enabled", label: "Problem", type: "checkbox" },
      { path: "homepage.sections.features.enabled", label: "Fitur Utama", type: "checkbox" },
      { path: "homepage.sections.preview.enabled", label: "Product Preview", type: "checkbox" },
      { path: "homepage.sections.reasons.enabled", label: "Why KlikPesantren", type: "checkbox" },
      { path: "homepage.sections.campaign_teaser.enabled", label: "Founding Partner Teaser", type: "checkbox" },
      { path: "homepage.sections.solution.enabled", label: "Solution", type: "checkbox" },
      { path: "homepage.sections.pricing_teaser.enabled", label: "Pricing Teaser", type: "checkbox" },
      { path: "homepage.sections.final_cta.enabled", label: "Final CTA", type: "checkbox" },
    ],
  },
  {
    title: "Homepage Copy",
    description: "Judul, deskripsi, CTA, dan daftar pada section homepage saat ini.",
    fields: [
      { path: "homepage.sections.proof.title", label: "Product Proof — Title" },
      { path: "homepage.sections.proof.description", label: "Product Proof — Description", type: "textarea" },
      ...DEFAULT_CONTENT.homepage.sections.proof.items.flatMap((item, index) => [
        { path: `homepage.sections.proof.items.${index}.title`, label: `Product Proof ${index + 1} — Title` },
        { path: `homepage.sections.proof.items.${index}.text`, label: `Product Proof ${index + 1} — Text`, type: "textarea" },
      ]),
      { path: "homepage.sections.problems.title", label: "Problem — Title" },
      { path: "homepage.sections.problems.description", label: "Problem — Description", type: "textarea" },
      { path: "homepage.sections.problems.items", label: "Problem Items (satu per baris)", type: "lines" },
      { path: "homepage.sections.solution.panel_title", label: "Solution Panel — Title" },
      { path: "homepage.sections.solution.panel_description", label: "Solution Panel — Description", type: "textarea" },
      { path: "homepage.sections.solution.title", label: "Solution — Title" },
      { path: "homepage.sections.solution.description", label: "Solution — Description", type: "textarea" },
      { path: "homepage.sections.features.title", label: "Fitur — Title" },
      { path: "homepage.sections.features.description", label: "Fitur — Description", type: "textarea" },
      ...DEFAULT_CONTENT.homepage.sections.features.items.flatMap((item, index) => [
        { path: `homepage.sections.features.items.${index}.title`, label: `Fitur ${index + 1} — Title` },
        { path: `homepage.sections.features.items.${index}.text`, label: `Fitur ${index + 1} — Text`, type: "textarea" },
      ]),
      { path: "homepage.sections.preview.title", label: "Preview — Title" },
      { path: "homepage.sections.preview.description", label: "Preview — Description", type: "textarea" },
      { path: "homepage.sections.preview.admin_image_url", label: "Admin Preview Image", type: "asset" },
      { path: "homepage.sections.preview.wali_image_url", label: "Wali Preview Image", type: "asset" },
      { path: "homepage.sections.reasons.title", label: "Why — Title" },
      { path: "homepage.sections.reasons.items", label: "Why Items (satu per baris)", type: "lines" },
      { path: "homepage.sections.pricing_teaser.title", label: "Pricing Teaser — Title" },
      { path: "homepage.sections.pricing_teaser.description", label: "Pricing Teaser — Description", type: "textarea" },
      { path: "homepage.sections.campaign_teaser.title", label: "Campaign Teaser — Title" },
      { path: "homepage.sections.campaign_teaser.description", label: "Campaign Teaser — Description", type: "textarea" },
      { path: "homepage.sections.final_cta.title", label: "Final CTA — Title" },
      { path: "homepage.sections.final_cta.description", label: "Final CTA — Description", type: "textarea" },
    ],
  },
  {
    title: "Campaign / Founding Partner",
    description: "Campaign sementara dapat dimatikan penuh tanpa perubahan kode.",
    fields: [
      { path: "campaign.enabled", label: "Campaign aktif", type: "checkbox" },
      { path: "campaign.nav_label", label: "Navigation Label" },
      { path: "campaign.page.hero_badge", label: "Hero Badge" },
      { path: "campaign.page.hero_title", label: "Hero Title" },
      { path: "campaign.page.hero_description", label: "Hero Description", type: "textarea" },
      { path: "campaign.page.hero_image_url", label: "Hero Image", type: "asset" },
      { path: "campaign.page.founding.enabled", label: "Section Program Terbatas", type: "checkbox" },
      { path: "campaign.page.founding.title", label: "Program Title" },
      { path: "campaign.page.founding.description", label: "Program Description", type: "textarea" },
      { path: "campaign.page.founding.quota", label: "Quota" },
      { path: "campaign.page.founding.quota_text", label: "Quota Copy" },
      { path: "campaign.page.benefits.enabled", label: "Benefit Section", type: "checkbox" },
      { path: "campaign.page.benefits.title", label: "Benefit Title" },
      { path: "campaign.page.benefits.items", label: "Benefits (satu per baris)", type: "lines" },
      { path: "campaign.page.pricing.enabled", label: "Pricing Section", type: "checkbox" },
      { path: "campaign.page.faqs.enabled", label: "FAQ Section", type: "checkbox" },
      { path: "campaign.page.faqs.title", label: "FAQ Title" },
      ...DEFAULT_CONTENT.campaign.page.faqs.items.flatMap((item, index) => [
        { path: `campaign.page.faqs.items.${index}.question`, label: `FAQ ${index + 1} — Question` },
        { path: `campaign.page.faqs.items.${index}.answer`, label: `FAQ ${index + 1} — Answer`, type: "textarea" },
      ]),
      { path: "campaign.page.final_cta.enabled", label: "Final CTA", type: "checkbox" },
      { path: "campaign.page.final_cta.title", label: "Final CTA Title" },
      { path: "campaign.page.final_cta.description", label: "Final CTA Description", type: "textarea" },
    ],
  },
  {
    title: "Public Page Heroes",
    description: "Konten utama halaman Fitur, Harga, Demo, Tentang, Kontak, dan Blog.",
    fields: [
      { path: "pages.features.hero.title", label: "Fitur — Title" }, { path: "pages.features.hero.text", label: "Fitur — Text", type: "textarea" },
      { path: "pages.pricing.hero.title", label: "Harga — Title" }, { path: "pages.pricing.hero.text", label: "Harga — Text", type: "textarea" },
      { path: "pages.demo.hero.title", label: "Demo — Title" }, { path: "pages.demo.hero.text", label: "Demo — Text", type: "textarea" },
      { path: "pages.about.hero.title", label: "Tentang — Title" }, { path: "pages.about.hero.text", label: "Tentang — Text", type: "textarea" },
      { path: "pages.contact.hero.title", label: "Kontak — Title" }, { path: "pages.contact.hero.text", label: "Kontak — Text", type: "textarea" },
      { path: "pages.blog.enabled", label: "Blog tampil", type: "checkbox" },
      { path: "pages.blog.hero.title", label: "Blog — Title" }, { path: "pages.blog.hero.text", label: "Blog — Text", type: "textarea" },
    ],
  },
  {
    title: "Public Page Content",
    description: "Cards, paket, artikel, cerita, prinsip, dan CTA pada halaman public saat ini.",
    fields: [
      ...DEFAULT_CONTENT.pages.features.items.flatMap((item, index) => [
        { path: `pages.features.items.${index}.title`, label: `Fitur Detail ${index + 1} — Title` },
        { path: `pages.features.items.${index}.summary`, label: `Fitur Detail ${index + 1} — Summary`, type: "textarea" },
        { path: `pages.features.items.${index}.points`, label: `Fitur Detail ${index + 1} — Points`, type: "lines" },
      ]),
      ...DEFAULT_CONTENT.pages.pricing.plans.flatMap((plan, index) => [
        { path: `pages.pricing.plans.${index}.name`, label: `Paket ${index + 1} — Name` },
        { path: `pages.pricing.plans.${index}.label`, label: `Paket ${index + 1} — Label` },
        { path: `pages.pricing.plans.${index}.text`, label: `Paket ${index + 1} — Description`, type: "textarea" },
        { path: `pages.pricing.plans.${index}.features`, label: `Paket ${index + 1} — Features`, type: "lines" },
      ]),
      { path: "pages.about.story_title", label: "Tentang — Story Title" },
      { path: "pages.about.story_paragraphs", label: "Tentang — Paragraphs", type: "lines" },
      ...DEFAULT_CONTENT.pages.about.principles.flatMap((principle, index) => [
        { path: `pages.about.principles.${index}.title`, label: `Prinsip ${index + 1} — Title` },
        { path: `pages.about.principles.${index}.text`, label: `Prinsip ${index + 1} — Text`, type: "textarea" },
      ]),
      { path: "pages.contact.whatsapp_text", label: "Contact — WhatsApp Copy", type: "textarea" },
      { path: "pages.contact.email_text", label: "Contact — Email Copy", type: "textarea" },
      { path: "pages.contact.instagram_text", label: "Contact — Instagram Copy", type: "textarea" },
      { path: "pages.contact.closing.enabled", label: "Contact Closing tampil", type: "checkbox" },
      { path: "pages.contact.closing.title", label: "Contact Closing — Title" },
      { path: "pages.contact.closing.text", label: "Contact Closing — Text", type: "textarea" },
      ...DEFAULT_CONTENT.pages.blog.posts.flatMap((post, index) => [
        { path: `pages.blog.posts.${index}.category`, label: `Artikel ${index + 1} — Category` },
        { path: `pages.blog.posts.${index}.title`, label: `Artikel ${index + 1} — Title` },
        { path: `pages.blog.posts.${index}.text`, label: `Artikel ${index + 1} — Summary`, type: "textarea" },
      ]),
    ],
  },
  {
    title: "Kontak",
    description: "Kontak resmi yang dipakai website public.",
    fields: [
      { path: "contact.whatsapp", label: "WhatsApp" },
      { path: "contact.email", label: "Email", type: "email" },
      { path: "contact.instagram", label: "Instagram URL" },
    ],
  },
  {
    title: "SEO Basic",
    description: "Metadata published dipakai oleh public website; fallback static tetap aman bila nilai kosong.",
    fields: [
      { path: "seo.default_title", label: "Default Title" },
      {
        path: "seo.default_description",
        label: "Default Description",
        type: "textarea",
      },
      { path: "seo.canonical_base_url", label: "Canonical Base URL" },
      { path: "seo.og_image_url", label: "OG Image", type: "asset" },
    ],
  },
  {
    title: "Footer",
    description: "Konten footer website public.",
    fields: [
      { path: "footer.description", label: "Description", type: "textarea" },
      { path: "footer.product_title", label: "Product Column Title" },
      { path: "footer.company_title", label: "Company Column Title" },
      { path: "footer.copyright", label: "Copyright" },
    ],
  },
];

function mergeContent(defaults = DEFAULT_CONTENT, content = {}) {
  if (Array.isArray(defaults)) return Array.isArray(content) ? content : defaults;
  if (!defaults || typeof defaults !== "object") return content ?? defaults;
  const source = content && typeof content === "object" ? content : {};
  const merged = { ...defaults, ...source };
  Object.keys(defaults).forEach((key) => { merged[key] = mergeContent(defaults[key], source[key]); });
  if (defaults === DEFAULT_CONTENT) {
    const legacy = content.homepage || {};
    if (legacy.hero_title && !content.homepage?.hero?.title) merged.homepage.hero.title = legacy.hero_title;
    if (legacy.hero_subtitle && !content.homepage?.hero?.subtitle) merged.homepage.hero.subtitle = legacy.hero_subtitle;
    ["primary_cta_label", "primary_cta_url", "secondary_cta_label", "secondary_cta_url"].forEach((key) => {
      if (legacy[key] && !content.homepage?.hero?.[key]) merged.homepage.hero[key] = legacy[key];
    });
  }
  return merged;
}

function getValue(content, path) {
  return path.split(".").reduce((value, key) => value?.[key], content) ?? "";
}

function setValue(content, path, value) {
  const keys = path.split(".");
  const next = Array.isArray(content) ? [...content] : { ...content };
  let cursor = next;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }

    cursor[key] = Array.isArray(cursor[key])
      ? [...cursor[key]]
      : { ...(cursor[key] || {}) };
    cursor = cursor[key];
  });

  return next;
}

function PlatformWebsitePage() {
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [status, setStatus] = useState("draft");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [publishedAt, setPublishedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dirty, setDirty] = useState(false);

  const loadContent = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await platformApi.get("/platform/website/content");
      const data = res.data?.data || {};
      setContent(mergeContent(data.content || {}));
      setStatus(data.status || "draft");
      setUpdatedAt(data.updated_at || null);
      setPublishedAt(data.published_at || null);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal memuat konten website");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Existing page-load request; state changes happen inside the awaited callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadContent();
  }, [loadContent]);

  const updateField = (path, value) => {
    setContent((current) => setValue(current, path, value));
    setDirty(true);
  };

  const saveDraft = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await platformApi.put("/platform/website/content", {
        content,
      });
      const data = res.data?.data || {};
      setContent(mergeContent(data.content || content));
      setStatus(data.status || "draft");
      setUpdatedAt(data.updated_at || null);
      setPublishedAt(data.published_at || null);
      setSuccess("Draft website resmi berhasil disimpan.");
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan draft website");
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError("");
    setSuccess("");
    try {
      const res = await platformApi.post("/platform/website/publish");
      const data = res.data?.data || {};
      setContent(mergeContent(data.content || content));
      setStatus(data.status || "published");
      setUpdatedAt(data.updated_at || null);
      setPublishedAt(data.published_at || null);
      setSuccess("Konten website resmi berhasil dipublish.");
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal publish website");
    } finally {
      setPublishing(false);
    }
  };

  const preview = () => {
    if (dirty) {
      setError("Simpan Draft terlebih dahulu agar Preview menampilkan perubahan terbaru.");
      return;
    }
    window.open("/platform/website/preview", "_blank", "noopener,noreferrer");
  };

  return (
    <div>
      <div style={headerStyle}>
        <div>
          <h1 className="platform-page-title">Website Resmi</h1>
          <p className="platform-page-subtitle">
            Edit konten website resmi klikpesantren.com. Layout tetap dari kode,
            konten dari database platform.
          </p>
        </div>
        <div style={statusStyle}>
          <span style={statusBadgeStyle}>{status}</span>
          {publishedAt ? (
            <span>Published {new Date(publishedAt).toLocaleString("id-ID")}</span>
          ) : null}
        </div>
      </div>

      {error ? <div className="theme-alert theme-alert--danger">{error}</div> : null}
      {success ? <div className="theme-alert theme-alert--success">{success}</div> : null}

      <div className="platform-compact-card">
        {loading ? (
          <p className="theme-muted">Memuat konten website...</p>
        ) : (
          <div style={sectionStackStyle}>
            {sections.map((section, index) => (
              <details key={section.title} style={sectionStyle} defaultOpen={index === 0}>
                <summary style={sectionSummaryStyle}>
                  <h2 className="theme-section-title">{section.title}</h2>
                  <p className="theme-muted" style={{ marginTop: -4 }}>
                    {section.description}
                  </p>
                </summary>

                <div style={formGridStyle}>
                  {section.fields.map((field) => field.type === "asset" ? (
                    <WebsiteAssetField
                      key={field.path}
                      label={field.label}
                      value={getValue(content, field.path)}
                      onChange={(value) => updateField(field.path, value)}
                    />
                  ) : (
                    <label
                      key={field.path}
                      className="theme-field-label"
                      style={field.type === "textarea" ? fullFieldStyle : undefined}
                    >
                      {field.label}
                      {field.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(getValue(content, field.path))}
                          onChange={(event) => updateField(field.path, event.target.checked)}
                        />
                      ) : field.type === "lines" ? (
                        <textarea
                          className="theme-field"
                          value={(getValue(content, field.path) || []).join("\n")}
                          onChange={(event) => updateField(field.path, event.target.value.split("\n").filter(Boolean))}
                          rows={5}
                        />
                      ) : field.type === "textarea" ? (
                        <textarea
                          className="theme-field"
                          value={getValue(content, field.path)}
                          onChange={(event) =>
                            updateField(field.path, event.target.value)
                          }
                          rows={4}
                        />
                      ) : (
                        <input
                          className="theme-field"
                          type={field.type || "text"}
                          value={getValue(content, field.path)}
                          onChange={(event) =>
                            updateField(field.path, event.target.value)
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}

        <div style={actionsStyle}>
          <PlatformButton
            variant="secondary"
            onClick={preview}
            disabled={loading || saving || publishing}
          >
            Preview
          </PlatformButton>
          <PlatformButton
            variant="secondary"
            onClick={loadContent}
            disabled={loading || saving || publishing}
          >
            Refresh
          </PlatformButton>
          <PlatformButton
            variant="secondary"
            onClick={saveDraft}
            loading={saving}
            disabled={loading || publishing}
          >
            Simpan Draft
          </PlatformButton>
          <PlatformButton
            variant="primary"
            onClick={publish}
            loading={publishing}
            disabled={loading || saving}
          >
            Publish
          </PlatformButton>
        </div>

        {updatedAt ? (
          <p className="theme-muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            Terakhir disimpan: {new Date(updatedAt).toLocaleString("id-ID")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 18,
};

const statusStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "var(--text-secondary)",
  fontSize: 12,
};

const statusBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 26,
  padding: "0 10px",
  borderRadius: 999,
  background: "var(--primary-subtle)",
  color: "var(--primary)",
  fontWeight: 800,
  textTransform: "uppercase",
};

const sectionStackStyle = {
  display: "grid",
  gap: 18,
};

const sectionStyle = {
  display: "grid",
  gap: 12,
  paddingBottom: 18,
  borderBottom: "1px solid var(--border)",
};

const sectionSummaryStyle = {
  cursor: "pointer",
  listStylePosition: "outside",
};

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 14,
};

const fullFieldStyle = {
  gridColumn: "1 / -1",
};

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 18,
};

export default PlatformWebsitePage;
