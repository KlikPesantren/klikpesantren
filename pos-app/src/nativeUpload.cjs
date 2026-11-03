// Expo SDK 57 fetch serializes Blob/bytes() parts, not RN's legacy { uri } parts.
// Keep file bytes lazy and bounded; do not change the API URL or auth client.
function appendNativeUpload(form, asset, FileClass, { name, mimeType, maxBytes, tooLargeCode } = {}) {
  const fail = (code, status = 400) => { throw Object.assign(Error(code), { code, status }); };
  if (!asset?.uri || typeof asset.uri !== 'string') fail('FILE_READ_FAILED');
  let file;
  try { file = new FileClass(asset.uri); if (!file.exists) fail('FILE_READ_FAILED'); }
  catch { fail('FILE_READ_FAILED'); }
  if (maxBytes && file.size > maxBytes) fail(tooLargeCode || 'FILE_TOO_LARGE', 413);
  const part = {
    name: asset.name || asset.fileName || name || file.name,
    type: asset.mimeType || mimeType || file.type || 'application/octet-stream',
    async bytes() {
      try { return await file.bytes(); }
      catch { return fail('FILE_READ_FAILED'); }
    },
  };
  form.append('file', part);
  return part;
}
module.exports = { appendNativeUpload };
