import { lazy, Suspense, useEffect, useState } from "react";
import ProtectedRoute from "./components/ProtectedRoute";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { TenantProfileProvider } from "./context/TenantProfileContext";
import { ActiveUnitProvider } from "./context/ActiveUnitContext";

import LoginPage from "./pages/LoginPage";
import TenantPortalErrorPage from "./pages/TenantPortalErrorPage";
import { getCurrentHostnameRoute } from "./utils/hostnameRouting";
import axios from "axios";
import { API_BASE_URL } from "./services/api";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const PembayaranPage = lazy(() => import("./pages/PembayaranPage"));
const PengumumanPage = lazy(() => import("./pages/PengumumanPage"));
const WaliHomeLinksPage = lazy(() => import("./pages/WaliHomeLinksPage"));

const RFIDMonitorPage = lazy(() => import("./pages/RFIDMonitorPage"));
const RFIDDashboardPage = lazy(() => import("./pages/RFIDDashboardPage"));
const RFIDTransactionPage = lazy(() => import("./pages/RFIDTransactionPage"));
const RFIDTopupPage = lazy(() => import("./pages/RFIDTopupPage"));
const WalletWithdrawalPage = lazy(() => import("./pages/WalletWithdrawalPage"));
const RFIDMerchantPage = lazy(() => import("./pages/RFIDMerchantPage"));
const RFIDDevicePage = lazy(() => import("./pages/RFIDDevicePage"));
const RFIDMutasiPage = lazy(() => import("./pages/RFIDMutasiPage"));
const RFIDRefundPage = lazy(() => import("./pages/RFIDRefundPage"));

import SantriPage from "./pages/SantriPage";
import AlumniPage from "./pages/AlumniPage";
import AuditPage from "./pages/AuditPage";
import DevicePage from "./pages/DevicePage";
import KelasPage from "./pages/KelasPage";
import AbsensiPage from "./pages/AbsensiPage";
import PerizinanPage from "./pages/PerizinanPage";
import PelanggaranPage from "./pages/PelanggaranPage";
import KesehatanPage from "./pages/KesehatanPage";
import HafalanPage from "./pages/HafalanPage";
import NilaiPage from "./pages/NilaiPage";
import MataPelajaranPage from "./pages/MataPelajaranPage";
import WaliPage from "./pages/WaliPage";
import AbsensiGuruPage from "./pages/AbsensiGuruPage";
import GuruPage from "./pages/GuruPage";
import BukuKasPage from "./pages/BukuKasPage";
import KasInstansiPage from "./pages/KasInstansiPage";
import KasInstansiKonsolidasiPage from "./pages/KasInstansiKonsolidasiPage";
import ProgramUnitPage from "./pages/ProgramUnitPage";
import SahriyahPage from "./pages/SahriyahPage";
import SahriyahSettingPage from "./pages/SahriyahSettingPage";
import TamuPage from "./pages/TamuPage";
import ProfilPesantrenPage from "./pages/ProfilPesantrenPage";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import UnitPendidikanPage from "./pages/UnitPendidikanPage";

import PlatformLoginPage from "./pages/platform/PlatformLoginPage";
import PlatformProtectedRoute from "./components/platform/PlatformProtectedRoute";
import PlatformLayout from "./components/platform/PlatformLayout";
import PlatformTenantsPage from "./pages/platform/PlatformTenantsPage";
import PlatformTenantDomainsPage from "./pages/platform/PlatformTenantDomainsPage";
import PlatformTenantDetailPage from "./pages/platform/PlatformTenantDetailPage";
import PlatformDashboardPage from "./pages/platform/PlatformDashboardPage";
import PlatformConsolePlaceholderPage from "./pages/platform/PlatformConsolePlaceholderPage";
import PlatformPackagesPage from "./pages/platform/PlatformPackagesPage";
import PlatformBillingOverviewPage from "./pages/platform/PlatformBillingOverviewPage";
import PlatformTenantHealthOverviewPage from "./pages/platform/PlatformTenantHealthOverviewPage";
import PlatformDeploymentChecklistPage from "./pages/platform/PlatformDeploymentChecklistPage";
import PlatformUploadStoragePage from "./pages/platform/PlatformUploadStoragePage";
import PlatformBackupRestorePage from "./pages/platform/PlatformBackupRestorePage";
import PlatformProfilePage from "./pages/platform/PlatformProfilePage";
import PlatformAnnouncementsPage from "./pages/platform/PlatformAnnouncementsPage";
import PlatformWebsitePage from "./pages/platform/PlatformWebsitePage";
import AboutKlikPesantrenPage from "./pages/AboutKlikPesantrenPage";
import PlatformInfoAnnouncementsPage from "./pages/PlatformInfoAnnouncementsPage";
import LandingPage from "./pages/LandingPage";
import FoundingPartnerPage from "./pages/FoundingPartnerPage";

const FeaturesPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.FeaturesPage,
  }))
);
const PricingPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.PricingPage,
  }))
);
const DemoPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.DemoPage,
  }))
);
const AboutPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.AboutPage,
  }))
);
const ContactPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.ContactPage,
  }))
);
const BlogPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.BlogPage,
  }))
);
const PrivacyPolicyPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.PrivacyPolicyPage,
  }))
);
const WaliSantriPrivacyPolicyPage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.WaliSantriPrivacyPolicyPage,
  }))
);
const TermsOfServicePage = lazy(() =>
  import("./pages/OfficialWebsitePages").then((module) => ({
    default: module.TermsOfServicePage,
  }))
);

function RouteFallback() {
  return null;
}

function LazyPage({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function CustomDomainRoot({ hostname }) {
  const [state, setState] = useState({ loading: true, slug: null });
  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/public/tenants/resolve-domain/by-hostname`, { params: { hostname } })
      .then((response) => {
        if (!active) return;
        const slug = response.data?.data?.tenant_slug || null;
        if (slug) localStorage.setItem("resolved_custom_tenant_slug", slug);
        setState({ loading: false, slug });
      })
      .catch(() => active && setState({ loading: false, slug: null }));
    return () => { active = false; };
  }, [hostname]);
  if (state.loading) return null;
  if (!state.slug) return <TenantPortalErrorPage type="not_found" />;
  return <LoginPage tenantSubdomain hostnameTenantSlug={state.slug} />;
}

function RootRoute() {
  const hostnameRoute = getCurrentHostnameRoute();

  if (import.meta.env.DEV) {
    console.info("[RootRoute] hostname route:", hostnameRoute);
  }

  if (hostnameRoute.type === "platform") {
    return <Navigate to="/platform" replace />;
  }

  if (hostnameRoute.type === "app") {
    return <LoginPage />;
  }

  if (hostnameRoute.type === "tenant") {
    return (
      <LoginPage
        tenantSubdomain
        hostnameTenantSlug={hostnameRoute.tenantSlug}
      />
    );
  }

  if (hostnameRoute.type === "custom-domain") {
    return <CustomDomainRoot hostname={hostnameRoute.hostname} />;
  }

  if (hostnameRoute.type === "local" || hostnameRoute.type === "preview") {
    return <LoginPage />;
  }

  if (hostnameRoute.type === "reserved" || hostnameRoute.type === "unknown") {
    return <TenantPortalErrorPage type="not_found" />;
  }

  return <LandingPage />;
}

function App() {
  return (
    <BrowserRouter>
      <TenantProfileProvider>
      <ActiveUnitProvider>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/landing" element={<Navigate to="/founding-partner" replace />} />
        <Route path="/founding-partner" element={<FoundingPartnerPage />} />
        <Route path="/fitur" element={<LazyPage><FeaturesPage /></LazyPage>} />
        <Route path="/harga" element={<LazyPage><PricingPage /></LazyPage>} />
        <Route path="/demo" element={<LazyPage><DemoPage /></LazyPage>} />
        <Route path="/tentang" element={<LazyPage><AboutPage /></LazyPage>} />
        <Route path="/blog" element={<LazyPage><BlogPage /></LazyPage>} />
        <Route path="/kontak" element={<LazyPage><ContactPage /></LazyPage>} />
        <Route path="/privacy-policy" element={<LazyPage><PrivacyPolicyPage /></LazyPage>} />
        <Route path="/privacy/walisantri" element={<LazyPage><WaliSantriPrivacyPolicyPage /></LazyPage>} />
        <Route path="/terms-of-service" element={<LazyPage><TermsOfServicePage /></LazyPage>} />

        {/* Platform Console — auth terpisah dari tenant admin */}
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route
          path="/platform"
          element={
            <PlatformProtectedRoute>
              <PlatformLayout />
            </PlatformProtectedRoute>
          }
        >
          <Route index element={<PlatformDashboardPage />} />
          <Route path="dashboard" element={<PlatformDashboardPage />} />
          <Route path="tenants" element={<PlatformTenantsPage />} />
          <Route path="tenant-domains" element={<PlatformTenantDomainsPage />} />
          <Route path="tenants/new" element={<PlatformTenantsPage initialCreate />} />
          <Route
            path="tenants/health"
            element={<PlatformTenantHealthOverviewPage />}
          />
          <Route path="tenants/:id" element={<PlatformTenantDetailPage />} />
          <Route path="billing" element={<PlatformBillingOverviewPage mode="subscriptions" />} />
          <Route path="billing/overdue" element={<PlatformBillingOverviewPage mode="overdue" />} />
          <Route
            path="billing/expiring-soon"
            element={<PlatformBillingOverviewPage mode="expiring-soon" />}
          />
          <Route path="packages" element={<PlatformPackagesPage />} />
          <Route
            path="features"
            element={<PlatformConsolePlaceholderPage type="features" />}
          />
          <Route
            path="support"
            element={<PlatformConsolePlaceholderPage type="support" />}
          />
          <Route
            path="support/tools"
            element={<PlatformConsolePlaceholderPage type="support" />}
          />
          <Route
            path="system"
            element={<PlatformConsolePlaceholderPage type="system" />}
          />
          <Route
            path="system/global-settings"
            element={<PlatformConsolePlaceholderPage type="system" />}
          />
          <Route
            path="system/deployment-checklist"
            element={<PlatformDeploymentChecklistPage />}
          />
          <Route path="system/upload-storage" element={<PlatformUploadStoragePage />} />
          <Route path="system/backup-restore" element={<PlatformBackupRestorePage />} />
          <Route
            path="system/announcements"
            element={<PlatformAnnouncementsPage />}
          />
          <Route path="website" element={<PlatformWebsitePage />} />
          <Route
            path="system/migration-status"
            element={<PlatformConsolePlaceholderPage type="system" />}
          />
          <Route path="profile" element={<PlatformProfilePage />} />
        </Route>

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <LazyPage>
                <DashboardPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/santri"
          element={
            <ProtectedRoute>
              <SantriPage />
            </ProtectedRoute>
          }
        />

        <Route path="/alumni" element={<ProtectedRoute><AlumniPage /></ProtectedRoute>} />

        <Route
          path="/kelas"
          element={
            <ProtectedRoute>
              <KelasPage />
            </ProtectedRoute>
          }
        />

        <Route path="/units" element={<ProtectedRoute><UnitPendidikanPage /></ProtectedRoute>} />

        <Route
          path="/wali"
          element={
            <ProtectedRoute>
              <WaliPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/pembayaran"
          element={
            <ProtectedRoute>
              <LazyPage>
                <PembayaranPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/buku-kas"
          element={
            <ProtectedRoute>
              <BukuKasPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/kas-instansi/konsolidasi"
          element={
            <ProtectedRoute>
              <KasInstansiKonsolidasiPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/kas-instansi"
          element={
            <ProtectedRoute>
              <KasInstansiPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/program-unit"
          element={
            <ProtectedRoute>
              <ProgramUnitPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/sahriyah"
          element={
            <ProtectedRoute>
              <SahriyahPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/sahriyah-setting"
          element={
            <ProtectedRoute>
              <SahriyahSettingPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-monitor"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDMonitorPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-dashboard"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDDashboardPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-transactions"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDTransactionPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-topup"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDTopupPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/wallet-withdrawal"
          element={
            <ProtectedRoute>
              <LazyPage>
                <WalletWithdrawalPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-merchant"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDMerchantPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-devices"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDDevicePage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-mutasi"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDMutasiPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rfid-refund"
          element={
            <ProtectedRoute>
              <LazyPage>
                <RFIDRefundPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/absensi"
          element={
            <ProtectedRoute>
              <AbsensiPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/absensi-guru"
          element={
            <ProtectedRoute>
              <AbsensiGuruPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/guru"
          element={
            <ProtectedRoute>
              <GuruPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/hafalan"
          element={
            <ProtectedRoute>
              <HafalanPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/nilai"
          element={
            <ProtectedRoute>
              <NilaiPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/mata-pelajaran"
          element={
            <ProtectedRoute>
              <MataPelajaranPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/perizinan"
          element={
            <ProtectedRoute>
              <PerizinanPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/kesehatan"
          element={
            <ProtectedRoute>
              <KesehatanPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/pelanggaran"
          element={
            <ProtectedRoute>
              <PelanggaranPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/tamu"
          element={
            <ProtectedRoute>
              <TamuPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/pengumuman"
          element={
            <ProtectedRoute>
              <LazyPage>
                <PengumumanPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/wali-home-links"
          element={
            <ProtectedRoute>
              <LazyPage>
                <WaliHomeLinksPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/profil-pesantren"
          element={
            <ProtectedRoute>
              <ProfilPesantrenPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/users"
          element={
            <ProtectedRoute>
              <UsersPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/roles"
          element={
            <ProtectedRoute>
              <RolesPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/audit"
          element={
            <ProtectedRoute>
              <AuditPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/devices"
          element={
            <ProtectedRoute>
              <DevicePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/about"
          element={
            <ProtectedRoute>
              <AboutKlikPesantrenPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/platform-announcements"
          element={
            <ProtectedRoute>
              <PlatformInfoAnnouncementsPage />
            </ProtectedRoute>
          }
        />
      </Routes>
      </ActiveUnitProvider>
      </TenantProfileProvider>
      </BrowserRouter>
  );
}

export default App;
