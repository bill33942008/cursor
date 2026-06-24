const app = getApp();

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
        reject(res.data || { message: "request failed" });
      },
      fail: reject,
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
          reject({ message: "invalid upload response" });
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
          return;
        }
        reject(data || { message: "upload failed" });
      },
      fail: reject,
    });
  });
}

module.exports = {
  request,
  uploadFile,
};
