const path = require('node:path');
const {getDefaultConfig} = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Resolve the installed SDK in standalone builds and existing-SDK local preflight.
// No machine path or dependency junction is part of this configuration.
const modules = path.dirname(path.dirname(require.resolve('expo/package.json')));
config.watchFolders = [...new Set([...(config.watchFolders || []), modules])];
config.resolver.nodeModulesPaths = [...new Set([modules, ...(config.resolver.nodeModulesPaths || [])])];
module.exports = config;
