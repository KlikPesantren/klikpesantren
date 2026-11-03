// Only testing builds opt in. Production/acceptance retain their existing policy.
function configureTestingNetwork(manifest, { enabled = false } = {}) {
  const application = manifest.manifest.application[0];
  application.$ = { ...application.$, "android:usesCleartextTraffic": enabled ? "true" : "false" };
  return manifest;
}

module.exports = function withTestingNetwork(config, options) {
  const { withAndroidManifest } = require("expo/config-plugins");
  return withAndroidManifest(config, result => {
    result.modResults = configureTestingNetwork(result.modResults, options);
    return result;
  });
};
module.exports.configureTestingNetwork = configureTestingNetwork;
