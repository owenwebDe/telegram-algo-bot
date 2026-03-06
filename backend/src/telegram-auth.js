const crypto = require("crypto");

function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 600) {
  if (!initData || !botToken) {
    return { ok: false, reason: "Missing initData or bot token" };
  }

  const params = new URLSearchParams(initData);
  const providedHash = params.get("hash");
  if (!providedHash) {
    return { ok: false, reason: "Missing Telegram hash" };
  }

  const entries = [];
  for (const pair of params.entries()) {
    const key = pair[0];
    const value = pair[1];
    if (key !== "hash") {
      entries.push(key + "=" + value);
    }
  }

  entries.sort();
  const dataCheckString = entries.join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const validHash = crypto.timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(providedHash, "hex"));

  if (!validHash) {
    return { ok: false, reason: "Invalid Telegram hash" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSeconds) {
    return { ok: false, reason: "Expired Telegram session" };
  }

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch (err) {
    user = null;
  }

  return { ok: true, user: user };
}

module.exports = {
  verifyTelegramInitData: verifyTelegramInitData,
};
