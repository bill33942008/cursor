const app = getApp();
let refreshingSessionPromise = null;

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

function refreshAuthSession() {
  if (refreshingSessionPromise) {
    return refreshingSessionPromise;
  }
  refreshingSessionPromise = Promise.resolve()
    .then(() => {
      if (typeof app.ensureAuthSession !== "function") {
        throw new Error("认证能力不可用，请重启小程序");
      }
      return app.ensureAuthSession({ forceRefresh: true });
    })
    .finally(() => {
      refreshingSessionPromise = null;
    });
  return refreshingSessionPromise;
}

function request(options) {
  const requestOptions = options || {};
  return new Promise((resolve, reject) => {
    try {
      wx.request({
        url: `${app.globalData.baseUrl}${requestOptions.url}`,
        method: requestOptions.method || "GET",
        data: requestOptions.data || {},
        header: {
          "content-type": "application/json",
          Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : "",
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
            return;
          }
          if (res.statusCode === 401 && !requestOptions._authRetried) {
            refreshAuthSession()
              .then(() =>
                resolve(
                  request({
                    ...requestOptions,
                    _authRetried: true,
                  })
                )
              )
              .catch((err) => reject(normalizeError(err, "登录状态已失效，请重新进入")))
              .finally(() => {
                // no-op
              });
            return;
          }
          const error = normalizeError(res.data, "request failed");
          error.statusCode = res.statusCode;
          reject(error);
        },
        fail: (err) => {
          reject(normalizeError(err, "network request failed"));
        },
      });
    } catch (err) {
      reject(normalizeError(err, "request invocation failed"));
    }
  });
}

function uploadFile(options) {
  const uploadOptions = options || {};
  return new Promise((resolve, reject) => {
    try {
      wx.uploadFile({
        url: `${app.globalData.baseUrl}${uploadOptions.url}`,
        filePath: uploadOptions.filePath,
        name: uploadOptions.name || "file",
        formData: uploadOptions.formData || {},
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
          if (res.statusCode === 401 && !uploadOptions._authRetried) {
            refreshAuthSession()
              .then(() =>
                resolve(
                  uploadFile({
                    ...uploadOptions,
                    _authRetried: true,
                  })
                )
              )
              .catch((err) => reject(normalizeError(err, "登录状态已失效，请重新进入")))
              .finally(() => {
                // no-op
              });
            return;
          }
          reject(normalizeError(data, "upload failed"));
        },
        fail: (err) => {
          reject(normalizeError(err, "upload network failed"));
        },
      });
    } catch (err) {
      reject(normalizeError(err, "upload invocation failed"));
    }
  });
}

module.exports = {
  request,
  uploadFile,
};
