const ADMIN_USER_ID = "admin";
const ADMIN_USERNAME = "admin";
const ADMIN_NICKNAME = "\u7ba1\u7406\u5458";
const SESSION_COOKIE = "tempest07_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_NOT_CONFIGURED = "\u767b\u5f55\u670d\u52a1\u672a\u914d\u7f6e";
const INVALID_LOGIN = "\u7528\u6237\u540d\u6216\u5bc6\u7801\u4e0d\u6b63\u786e";

export function adminUser() {
  return {
    id: ADMIN_USER_ID,
    username: ADMIN_USERNAME,
    nickname: ADMIN_NICKNAME,
    role: "admin",
  };
}

export async function loginUser(request, env) {
  const passwordSecret = adminPassword(env);
  if (!passwordSecret) return json({ ok: false, error: LOGIN_NOT_CONFIGURED }, 503);
  const secret = authSecret(env);
  if (!secret) return json({ ok: false, error: LOGIN_NOT_CONFIGURED }, 503);

  const body = await request.json().catch(() => ({}));
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (username !== ADMIN_USERNAME || !(await timingSafeEqualHash(password, passwordSecret))) {
    return json({ ok: false, error: INVALID_LOGIN }, 401);
  }

  const user = adminUser();
  const token = await signSession(user, secret);
  return json({ ok: true, user, message: `Welcome back, ${user.nickname}` }, 200, {
    "Set-Cookie": sessionCookie(token, request),
  });
}

export async function sessionUser(request, env) {
  const user = await verifySession(request, env);
  return json(user ? { ok: true, user } : { ok: false, error: "Unauthorized" }, user ? 200 : 401);
}

export function logoutUser(request) {
  return json({ ok: true }, 200, {
    "Set-Cookie": clearSessionCookie(request),
  });
}

export async function verifySession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifySignedPayload(token, authSecret(env));
  if (!payload || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (payload.username !== ADMIN_USERNAME) return null;
  return {
    id: ADMIN_USER_ID,
    username: ADMIN_USERNAME,
    nickname: payload.nickname || ADMIN_NICKNAME,
    role: payload.role || "admin",
  };
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function signSession(user, secret) {
  return signPayload({
    sub: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }, secret);
}

async function signPayload(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacHex(secret, body);
  return `${body}.${signature}`;
}

async function verifySignedPayload(token, secret) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !secret) return null;
  const expected = await hmacHex(secret, body);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    return JSON.parse(base64UrlDecode(body));
  } catch {
    return null;
  }
}

function sessionCookie(token, request) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    new URL(request.url).protocol === "https:" ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearSessionCookie(request) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    new URL(request.url).protocol === "https:" ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("=") || "");
    } catch {
      return "";
    }
  }
  return "";
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(value || "")));
  return bytesToHex(new Uint8Array(signature));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return bytesToHex(new Uint8Array(digest));
}

async function timingSafeEqualHash(left, right) {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  return timingSafeEqual(leftHash, rightHash);
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function authSecret(env = {}) {
  return String(env.TEMPEST_AUTH_SECRET || env.GATEWAY_AUTH_SECRET || "").trim();
}

function adminPassword(env = {}) {
  return String(env.TEMPEST_ADMIN_PASSWORD || env.ADMIN_PASSWORD || env.APP_PASSWORD || "").trim();
}
