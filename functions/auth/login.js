import { loginUser, json } from "./_shared.js";

export async function onRequest(context) {
  if (context.request.method === "POST") return loginUser(context.request, context.env);
  return json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST",
  });
}
