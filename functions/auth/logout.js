import { logoutUser, json } from "./_shared.js";

export function onRequest(context) {
  if (context.request.method === "POST") return logoutUser(context.request);
  return json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST",
  });
}
