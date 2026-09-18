const fs = require('node:fs');
const path = require('node:path');

const UNIVERSAL = Object.freeze({
  brand_key: 'universal', mode: 'universal', app_name: 'WaliSantri', short_name: 'WaliSantri',
  slogan: 'Portal wali santri, didukung KlikPesantren', primary_color: '#078A46',
  package_id: 'com.klikpesantren.wali', tenant_id: null, tenant_slug: null,
  logo: './assets/universal-walisantri-icon-1024.png', icon: './assets/universal-walisantri-icon-1024.png', splash_logo: './assets/universal-walisantri-splash-1024.png',
  adaptive_foreground: './assets/universal-walisantri-foreground-1024.png', adaptive_background: null,
  adaptive_monochrome: './assets/universal-walisantri-monochrome-1024.png', current_version_name: '1.0.0', current_version_code: 13,
  status: 'BUILD_READY', powered_by_klikpesantren: true,
});

function validate(profile, { strict = false } = {}) {
  if (!profile || !/^[a-z][a-z0-9]{1,62}$/.test(profile.brand_key || '')) throw new Error('BUILD_BRAND profile memiliki brand_key tidak valid');
  if (!['universal', 'white_label'].includes(profile.mode)) throw new Error('BUILD_BRAND mode tidak valid');
  if (profile.mode === 'white_label' && !profile.tenant_id) throw new Error('White-label build wajib terikat tenant_id');
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(profile.package_id || '')) throw new Error('BUILD_BRAND package_id tidak valid');
  if (!/^#[0-9A-Fa-f]{6}$/.test(profile.primary_color || '')) throw new Error('BUILD_BRAND primary_color tidak valid');
  if (strict && !['BUILD_READY', 'PUBLISHED'].includes(profile.status)) throw new Error('Brand harus BUILD_READY atau PUBLISHED untuk release build');
  return {
    ...profile,
    logo: profile.logo || profile.logo_url,
    icon: profile.icon || profile.icon_url || profile.logo || profile.logo_url,
    splash_logo: profile.splash_logo || profile.splash_logo_url || profile.logo || profile.logo_url,
    powered_by_klikpesantren: true,
  };
}

function resolveBuildBrand(env = process.env, projectRoot = path.resolve(__dirname, '..')) {
  const requested = String(env.BUILD_BRAND || 'universal').trim().toLowerCase();
  if (requested === 'universal' && !env.BUILD_BRAND_PROFILE) return validate({ ...UNIVERSAL, current_version_code: Number(env.BUILD_VERSION_CODE || UNIVERSAL.current_version_code) }, { strict: env.BRAND_BUILD_STRICT === '1' });
  if (!env.BUILD_BRAND_PROFILE) throw new Error('BUILD_BRAND_PROFILE wajib untuk white-label build');
  const profile = JSON.parse(fs.readFileSync(path.resolve(projectRoot, env.BUILD_BRAND_PROFILE), 'utf8'));
  if (profile.brand_key !== requested) throw new Error('BUILD_BRAND tidak cocok dengan profile file');
  return validate(profile, { strict: env.BRAND_BUILD_STRICT === '1' });
}

function assertFirebasePackage(googleServicesFile, packageId) {
  if (!googleServicesFile) throw new Error(`GOOGLE_SERVICES_JSON wajib untuk package ${packageId}`);
  const json = JSON.parse(fs.readFileSync(path.resolve(googleServicesFile), 'utf8'));
  const packages = (json.client || []).map((item) => item?.client_info?.android_client_info?.package_name).filter(Boolean);
  if (!packages.includes(packageId)) throw new Error(`Firebase config tidak terdaftar untuk package ${packageId}`);
  return true;
}

module.exports = { UNIVERSAL, resolveBuildBrand, assertFirebasePackage, validate };
