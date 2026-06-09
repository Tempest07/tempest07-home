const ROUTES = [
  {
    prefix: "/trade-converter",
    origin: "https://trade-phraser.pages.dev",
  },
  {
    prefix: "/trade-recorder",
    origin: "https://trade-recorder.pages.dev",
  },
  {
    prefix: "/news-feed",
    origin: "https://tempest07-news-feed.pages.dev",
  },
];

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
