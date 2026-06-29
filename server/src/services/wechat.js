const { URLSearchParams } = require("url");

const tokenCache = {
  accessToken: "",
  expireAtMs: 0,
};

function isRealLoginMode() {
  return (process.env.WECHAT_LOGIN_MODE || "mock").toLowerCase() === "real";
}

function isSecurityEnabled() {
  return (process.env.WECHAT_SECURITY_ENABLED || "false").toLowerCase() === "true";
}

function getWechatConfig() {
  return {
    appId: process.env.WECHAT_APPID || "",
    appSecret: process.env.WECHAT_SECRET || "",
  };
}

function ensureWechatConfigured() {
  const { appId, appSecret } = getWechatConfig();
  if (!appId || !appSecret) {
    throw new Error("WECHAT_APPID/WECHAT_SECRET are required in real mode");
  }
  return { appId, appSecret };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  return data;
}

async function exchangeCodeForOpenId(code) {
  if (!isRealLoginMode()) {
    return {
      openid: `mock_wx_${code}`,
      unionid: null,
      sessionKey: `mock_session_${code}`,
      provider: "mock",
    };
  }

  const { appId, appSecret } = ensureWechatConfigured();
  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: code,
    grant_type: "authorization_code",
  });

  const data = await requestJson(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);
  if (data.errcode) {
    throw new Error(`wechat code2Session failed: ${data.errcode} ${data.errmsg || ""}`.trim());
  }

  return {
    openid: data.openid,
    unionid: data.unionid || null,
    sessionKey: data.session_key || null,
    provider: "wechat",
  };
}

async function getWechatAccessToken() {
  if (!isSecurityEnabled()) {
    throw new Error("wechat security disabled");
  }
  if (tokenCache.accessToken && Date.now() < tokenCache.expireAtMs) {
    return tokenCache.accessToken;
  }

  const { appId, appSecret } = ensureWechatConfigured();
  const params = new URLSearchParams({
    grant_type: "client_credential",
    appid: appId,
    secret: appSecret,
  });
  const data = await requestJson(`https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`);
  if (data.errcode) {
    throw new Error(`wechat getAccessToken failed: ${data.errcode} ${data.errmsg || ""}`.trim());
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expireAtMs = Date.now() + Math.max((data.expires_in || 7200) - 300, 60) * 1000;
  return tokenCache.accessToken;
}

function evaluateTextSecurityResult(data) {
  // New API returns result.suggest or result.label.
  const suggest = data?.result?.suggest;
  if (suggest === "risky") {
    return { risky: true, reason: "wechat suggest risky" };
  }
  if (suggest === "pass") {
    return { risky: false };
  }
  if (data?.errcode === 87014) {
    return { risky: true, reason: "wechat legacy hit 87014" };
  }
  return { risky: false };
}

async function checkTextSecurity(content, openid) {
  const accessToken = await getWechatAccessToken();
  const payload = {
    content,
    version: 2,
    scene: 2,
    openid,
  };
  const data = await requestJson(
    `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (data.errcode && data.errcode !== 0 && data.errcode !== 87014) {
    throw new Error(`wechat msg_sec_check failed: ${data.errcode} ${data.errmsg || ""}`.trim());
  }
  return data;
}

async function submitMediaSecurityCheck({ mediaUrl, mediaType = 2, openid }) {
  const accessToken = await getWechatAccessToken();
  const payload = {
    media_url: mediaUrl,
    media_type: mediaType,
    version: 2,
    scene: 2,
    openid,
  };

  const data = await requestJson(
    `https://api.weixin.qq.com/wxa/media_check_async?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`wechat media_check_async failed: ${data.errcode} ${data.errmsg || ""}`.trim());
  }
  return data;
}

module.exports = {
  exchangeCodeForOpenId,
  isRealLoginMode,
  isSecurityEnabled,
  checkTextSecurity,
  evaluateTextSecurityResult,
  submitMediaSecurityCheck,
};
