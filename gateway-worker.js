const CANONICAL_ORIGIN = "https://tempest07.com";

const ROUTES = [
  {
    prefix: "/gateway",
    origin: "https://tempest07-home.pages.dev",
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

const LEGACY_ROUTES = [
  ["/trade-converter", "/trade-excel-writer"],
  ["/trade-recorder", "/trade-record"],
  ["/news-feed", "/newsfeed"],
  ["/credit-bond-process", "/bond-centre"],
];

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

async function proxy(request, targetOrigin, prefix = "") {
  const incomingUrl = new URL(request.url);
  let targetPath = incomingUrl.pathname.slice(prefix.length) || "/";

  if (!targetPath.startsWith("/")) {
    targetPath = `/${targetPath}`;
  }

  const targetUrl = new URL(`${targetPath}${incomingUrl.search}`, targetOrigin);
  const headers = new Headers(request.headers);
  headers.set("host", targetUrl.host);

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

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(`${CANONICAL_ORIGIN}/gateway/`, 301);
    }

    const legacyTarget = legacyRedirect(url);
    if (legacyTarget) return Response.redirect(legacyTarget, 301);

    if (url.hostname !== "tempest07.com") {
      return Response.redirect(redirectUrl(url, url.pathname), 301);
    }

    for (const route of ROUTES) {
      if (url.pathname === route.prefix) {
        return Response.redirect(`${url.origin}${route.prefix}/`, 301);
      }

      if (url.pathname.startsWith(`${route.prefix}/`)) {
        return proxy(request, route.origin, route.prefix);
      }
    }

    return proxy(request, "https://tempest07-home.pages.dev");
  },
};
