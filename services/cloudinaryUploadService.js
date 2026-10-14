const { v2: cloudinary } = require("cloudinary");

let configured = false;

function ensureCloudinaryConfigured() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const err = new Error("Konfigurasi Cloudinary belum tersedia di server.");
    err.code = "CLOUDINARY_NOT_CONFIGURED";
    throw err;
  }

  if (!configured) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    configured = true;
  }
}

function uploadImageBuffer(buffer, options = {}) {
  ensureCloudinaryConfigured();

  const rootFolder = process.env.CLOUDINARY_FOLDER || "kliksantri";
  const subfolder = options.folder == null ? "" : String(options.folder);
  if (subfolder && !/^[a-z0-9/_-]{1,160}$/i.test(subfolder)) {
    const err = new Error("Folder upload tidak valid.");
    err.code = "INVALID_UPLOAD_FOLDER";
    throw err;
  }
  const folder = subfolder ? `${rootFolder}/${subfolder}` : rootFolder;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        transformation: options.productImage
          ? [{ width: 1600, height: 1600, crop: "limit", quality: "auto:good", fetch_format: "auto" }]
          : undefined,
        context: options.originalName
          ? { original_name: options.originalName }
          : undefined,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );

    stream.end(buffer);
  });
}

module.exports = {
  uploadImageBuffer,
};
