function localProductUploadDisabled(req, res, next) {
  const error = new Error('Upload file lokal dinonaktifkan. Masukkan URL HTTPS produk digital pada formulir produk.');
  error.status = 400;
  next(error);
}

const productAssetUpload = {
  single() {
    return localProductUploadDisabled;
  }
};

function removeUploadedFile() {}

module.exports = { productAssetUpload, removeUploadedFile };
