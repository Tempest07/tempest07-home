const CANONICAL_ORIGIN = "https://tempest07.com";
const HOME_ORIGIN = "https://tempest07-home.pages.dev";
const SESSION_COOKIE = "tempest07_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ASSERTION_TTL_SECONDS = 5 * 60;

const ROUTES = [
  {
    prefix: "/gateway",
    origin: HOME_ORIGIN,
  },
  {
    prefix: "/trade-excel-writer",
    origin: "https://trade-phraser.pages.dev",
  },
  {
    prefix: "/trade-record",
    origin: "https://trade-recorder.pages.dev",
  },
  {
    prefix: "/newsfeed",
    origin: "https://tempest07-news-feed.pages.dev",
  },
  {
    prefix: "/bond-centre",
    origin: "https://credit-bond-process.pages.dev",
  },
  {
    prefix: "/weekly-report",
    origin: "https://weekly-report-generator-7a5.pages.dev",
  },
];

const PUBLIC_PREFIXES = ["/gateway", "/login", "/auth"];

const LEGACY_ROUTES = [
  ["/trade-converter", "/trade-excel-writer"],
  ["/trade-recorder", "/trade-record"],
  ["/news-feed", "/newsfeed"],
  ["/credit-bond-process", "/bond-centre"],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(`${CANONICAL_ORIGIN}/gateway/`, 301);
    }

    if (url.hostname !== "tempest07.com") {
      return Response.redirect(redirectUrl(url, url.pathname), 301);
    }

    if (url.pathname === "/login" || url.pathname === "/login/") {
      return handleLoginPage(request);
    }

    const authResponse = await handleAuth(request, env);
    if (authResponse) return authResponse;

    const legacyTarget = legacyRedirect(url);
    if (legacyTarget) return Response.redirect(legacyTarget, 301);

    const user = await verifySession(request, env);
    if (!user && !isPublicPath(url.pathname)) {
      return wantsJson(request)
        ? json({ ok: false, error: "Unauthorized" }, 401)
        : loginRedirect(request);
    }

    for (const route of ROUTES) {
      if (url.pathname === route.prefix) {
        return Response.redirect(`${url.origin}${route.prefix}/`, 301);
      }

      if (url.pathname.startsWith(`${route.prefix}/`)) {
        return proxy(request, route.origin, route.prefix, env, user);
      }
    }

    return proxy(request, HOME_ORIGIN, "", env, user);
  },
};

function redirectUrl(url, pathname) {
  return `${CANONICAL_ORIGIN}${pathname}${url.search}`;
}

function legacyRedirect(url) {
  for (const [from, to] of LEGACY_ROUTES) {
    if (url.pathname === from) return redirectUrl(url, `${to}/`);
    if (url.pathname.startsWith(`${from}/`)) {
      return redirectUrl(url, `${to}${url.pathname.slice(from.length)}`);
    }
  }
  return "";
}

async function proxy(request, targetOrigin, prefix = "", env = {}, user = null) {
  const incomingUrl = new URL(request.url);
  let targetPath = incomingUrl.pathname.slice(prefix.length) || "/";

  if (!targetPath.startsWith("/")) {
    targetPath = `/${targetPath}`;
  }

  const targetUrl = new URL(`${targetPath}${incomingUrl.search}`, targetOrigin);
  const headers = new Headers(request.headers);
  headers.set("host", targetUrl.host);
  headers.delete("x-tempest-auth");
  headers.delete("x-tempest-user");

  if (user) {
    headers.set("x-tempest-auth", await gatewayAssertion(user, env));
    headers.set("x-tempest-user", user.username);
  }

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
  }

  const upstream = await fetch(new Request(targetUrl, init));
  const response = new Response(upstream.body, upstream);
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

async function handleAuth(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/auth/session" && request.method === "GET") {
    const user = await verifySession(request, env);
    return json(user ? { ok: true, user } : { ok: false, error: "Unauthorized" }, user ? 200 : 401);
  }

  if (url.pathname === "/auth/logout" && request.method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": clearSessionCookie(request),
    });
  }

  if (url.pathname === "/auth/login" && request.method === "POST") {
    const passwordSecret = adminPassword(env);
    if (!passwordSecret) return json({ ok: false, error: "Gateway password is not configured" }, 503);
    if (!authSecret(env)) return json({ ok: false, error: "Gateway auth secret is not configured" }, 503);

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (username !== "admin" || !(await timingSafeEqualHash(password, passwordSecret))) {
      return json({ ok: false, error: "Invalid username or password" }, 401);
    }

    const user = adminUser();
    const token = await signSession(user, env);
    return json({
      ok: true,
      user,
      message: `Welcome back, ${user.nickname}`,
    }, 200, {
      "Set-Cookie": sessionCookie(token, request),
    });
  }

  if (url.pathname.startsWith("/auth/")) {
    return json({ ok: false, error: "Not found" }, 404);
  }

  return null;
}

async function handleLoginPage(request) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  const url = new URL(request.url);
  const target = new URL("/login", HOME_ORIGIN);
  target.search = url.search;
  return fetch(target.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
  });
}

function isPublicPath(pathname) {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function wantsJson(request) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json") || new URL(request.url).pathname.includes("/api/");
}

function loginRedirect(request) {
  const url = new URL(request.url);
  const login = new URL("/login", CANONICAL_ORIGIN);
  login.searchParams.set("next", `${url.pathname}${url.search}`);
  return Response.redirect(login.toString(), 302);
}

function adminUser() {
  return {
    id: "admin",
    username: "admin",
    nickname: "管理员",
    role: "admin",
  };
}

async function signSession(user, env) {
  const payload = {
    sub: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  return signPayload(payload, authSecret(env));
}

async function verifySession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifyPayload(token, authSecret(env));
  if (!payload || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (payload.username !== "admin") return null;
  return {
    id: "admin",
    username: "admin",
    nickname: payload.nickname || "管理员",
    role: payload.role || "admin",
  };
}

async function gatewayAssertion(user, env) {
  return signPayload({
    sub: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + ASSERTION_TTL_SECONDS,
  }, authSecret(env));
}

async function signPayload(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacHex(secret, body);
  return `${body}.${signature}`;
}

async function verifyPayload(token, secret) {
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
    if (rawKey === name) return decodeURIComponent(rawValue.join("=") || "");
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

function json(data, status = 200, extraHeaders = {}) {
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
