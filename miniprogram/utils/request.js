const app = getApp();

function normalizeError(input, fallbackMessage) {
  if (!input) {
    return { message: fallbackMessage };
  }
  if (typeof input === "string") {
    return { message: input };
  }
  if (typeof input.message === "string" && input.message) {
    return { message: input.message, code: input.code || "", errMsg: input.errMsg || "" };
  }
  if (typeof input.errMsg === "string" && input.errMsg) {
    return { message: input.errMsg, code: input.code || "", errMsg: input.errMsg };
  }
  if (typeof input === "object") {
    // Return a shallow, JSON-safe object to avoid "could not be cloned".
    return {
      message: fallbackMessage,
      code: typeof input.code === "string" ? input.code : "",
      errMsg: typeof input.errMsg === "string" ? input.errMsg : "",
      statusCode: Number(input.statusCode) || 0,
    };
  }
  return { message: fallbackMessage };
}

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.baseUrl}${options.url}`,
      method: options.method || "GET",
      data: options.data || {},
      header: {
        "content-type": "application/json",
        Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : "",
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(normalizeError(res.data, "request failed"));
      },
      fail: (err) => {
        reject(normalizeError(err, "network request failed"));
      },
    });
  });
}

function uploadFile(options) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${app.globalData.baseUrl}${options.url}`,
      filePath: options.filePath,
      name: options.name || "file",
      formData: options.formData || {},
      header: {
        Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : "",
      },
      success: (res) => {
        let data = {};
        try {
          data = JSON.parse(res.data);
        } catch (_err) {
          reject(normalizeError(null, "invalid upload response"));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
          return;
        }
        reject(normalizeError(data, "upload failed"));
      },
      fail: (err) => {
        reject(normalizeError(err, "upload network failed"));
      },
    });
  });
}

module.exports = {
  request,
  uploadFile,
};
