const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const COS = require("cos-nodejs-sdk-v5");

const uploadRoot = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadRoot, { recursive: true });

function getCosConfig() {
  return {
    secretId: process.env.COS_SECRET_ID || "",
    secretKey: process.env.COS_SECRET_KEY || "",
    bucket: process.env.COS_BUCKET || "",
    region: process.env.COS_REGION || "",
    publicBaseUrl: process.env.COS_PUBLIC_BASE_URL || "",
  };
}

function hasCosConfig() {
  const conf = getCosConfig();
  return Boolean(conf.secretId && conf.secretKey && conf.bucket && conf.region);
}

function getExtByMime(mimeType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
  };
  return map[mimeType] || "";
}

function normalizeMimeType(file) {
  const rawMimeType = String(file?.mimetype || "").toLowerCase().trim();
  const aliasMap = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
    "image/heic-sequence": "image/heic",
    "image/heif-sequence": "image/heif",
    "video/mov": "video/quicktime",
  };
  const allowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "video/mp4",
    "video/quicktime",
  ]);

  const mappedMimeType = aliasMap[rawMimeType] || rawMimeType;
  if (allowed.has(mappedMimeType)) {
    return mappedMimeType;
  }

  const filename = String(file?.originalname || "").toLowerCase();
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".heic")) return "image/heic";
  if (filename.endsWith(".heif")) return "image/heif";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".mov") || filename.endsWith(".m4v")) return "video/quicktime";

  if (!mappedMimeType) {
    throw new Error("unsupported file type");
  }
  throw new Error(`unsupported file type: ${mappedMimeType}`);
}

function makeStorageKey(mimeType) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `media/${yyyy}/${mm}/${dd}/${uuidv4()}${getExtByMime(mimeType)}`;
}

function writeLocalFile(buffer, key) {
  const targetPath = path.join(uploadRoot, key.replace(/^media\//, ""));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);
}

function getLocalUrl(key) {
  return `/uploads/${key.replace(/^media\//, "")}`;
}

async function putToCos(buffer, key, mimeType) {
  const conf = getCosConfig();
  const cos = new COS({
    SecretId: conf.secretId,
    SecretKey: conf.secretKey,
  });

  await new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: conf.bucket,
        Region: conf.region,
        Key: key,
        StorageClass: "STANDARD",
        Body: buffer,
        ContentType: mimeType,
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });

  const base = conf.publicBaseUrl || `https://${conf.bucket}.cos.${conf.region}.myqcloud.com`;
  return `${base.replace(/\/$/, "")}/${key}`;
}

async function uploadBuffer(file) {
  if (!file?.buffer) {
    throw new Error("file is required");
  }
  const mimeType = normalizeMimeType(file);
  const key = makeStorageKey(mimeType);

  if (hasCosConfig()) {
    const url = await putToCos(file.buffer, key, mimeType);
    return {
      provider: "cos",
      key,
      url,
      mimeType,
      sizeBytes: file.size,
    };
  }

  writeLocalFile(file.buffer, key);
  return {
    provider: "local",
    key,
    url: getLocalUrl(key),
    mimeType,
    sizeBytes: file.size,
  };
}

module.exports = {
  uploadBuffer,
};
