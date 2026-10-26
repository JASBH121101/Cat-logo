export async function onRequest({ request, env }) {
  return Response.json({ ok: true });
}
