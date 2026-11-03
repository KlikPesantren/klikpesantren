const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
function loadSdkMultipart() {
  const sdk=process.env.POS_EXPO_SDK_ROOT || path.dirname(require.resolve('expo/package.json'));
  const sdkRequire=createRequire(path.join(sdk,'package.json'));
  const babel=sdkRequire('@babel/core');
  function load(relative) {
    const filename=path.join(sdk,relative);
    const result=babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,babelrc:false,configFile:false,plugins:[sdkRequire.resolve('@babel/plugin-transform-typescript'),sdkRequire.resolve('@babel/plugin-transform-modules-commonjs')]});
    const m={exports:{}};new Function('require','module','exports',result.code)(name=>{
      if(name==='../../utils/blobUtils')return {blobToArrayBufferAsync:blob=>blob.arrayBuffer()};
      throw Error('UNEXPECTED_SDK_DEPENDENCY');
    },m,m.exports);return m.exports;
  }
  class RNFormData { constructor(){this._parts=[];} }
  const ExpoFormData=load('src/winter/FormData.ts').installFormDataPatch(RNFormData);
  return {ExpoFormData,convertFormDataAsync:load('src/winter/fetch/convertFormData.ts').convertFormDataAsync,sdkVersion:JSON.parse(fs.readFileSync(path.join(sdk,'package.json'))).version};
}
module.exports={loadSdkMultipart};
