const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadRoot = path.resolve(__dirname, '../../private_uploads/products');
fs.mkdirSync(uploadRoot, { recursive: true });

function safeExtension(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return extension.slice(0, 12);
}

const storage = multer.diskStorage({
  destination: uploadRoot,
  filename: (req, file, callback) => {
    callback(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${safeExtension(file.originalname)}`);
  }
});

const productAssetUpload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_PRODUCT_FILE_BYTES || 100 * 1024 * 1024),
    files: 1,
    fields: 80
  }
});

function removeUploadedFile(file) {
  if (!file?.path) return;
  fs.promises.unlink(file.path).catch(() => {});
}

module.exports = { productAssetUpload, removeUploadedFile, uploadRoot };
