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
    "video/mp4": ".mp4",
  };
  return map[mimeType] || "";
}

function normalizeMimeType(mimeType) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);
  if (!allowed.has(mimeType)) {
    throw new Error(`unsupported file type: ${mimeType}`);
  }
  return mimeType;
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
  const mimeType = normalizeMimeType(file.mimetype);
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
