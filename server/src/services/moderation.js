const { isSecurityEnabled, checkTextSecurity, evaluateTextSecurityResult, submitMediaSecurityCheck } = require("./wechat");

const defaultBlockedWords = [
  "赌博",
  "色情",
  "毒品",
  "诈骗",
  "暴力",
  "约炮",
  "枪支",
  "恐怖",
];

function getBlockedWords() {
  const custom = (process.env.CUSTOM_BLOCKED_WORDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...defaultBlockedWords, ...custom])];
}

function localTextReview(content) {
  const lowerText = String(content || "").toLowerCase();
  const hit = getBlockedWords().find((word) => lowerText.includes(word.toLowerCase()));
  if (hit) {
    return {
      status: "rejected",
      provider: "local",
      reason: `blocked_word:${hit}`,
    };
  }
  return {
    status: "approved",
    provider: "local",
  };
}

async function moderateText({ content, openid }) {
  const localResult = localTextReview(content);
  if (localResult.status === "rejected") {
    return localResult;
  }

  if (!isSecurityEnabled()) {
    return localResult;
  }

  try {
    const securityResponse = await checkTextSecurity(content, openid);
    const evaluated = evaluateTextSecurityResult(securityResponse);
    if (evaluated.risky) {
      return {
        status: "rejected",
        provider: "wechat",
        reason: evaluated.reason || "wechat_risky",
      };
    }
    return {
      status: "approved",
      provider: "wechat",
    };
  } catch (err) {
    return {
      status: "review",
      provider: "wechat",
      reason: err.message || "wechat_check_failed",
    };
  }
}

async function moderateMedia({ mediaUrl, mediaType, openid }) {
  if (!isSecurityEnabled()) {
    return {
      status: "approved",
      provider: "local",
    };
  }

  try {
    await submitMediaSecurityCheck({ mediaUrl, mediaType, openid });
    return {
      status: "review",
      provider: "wechat",
      reason: "async_media_review_submitted",
    };
  } catch (err) {
    return {
      status: "review",
      provider: "wechat",
      reason: err.message || "wechat_media_check_failed",
    };
  }
}

module.exports = {
  moderateText,
  moderateMedia,
};
