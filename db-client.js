import { createClient, SupabaseAuthAdapter } from "https://cdn.jsdelivr.net/npm/@neondatabase/neon-js@0.9.0-beta/+esm";

const SDK_VERSION = "0.9.0-beta";

function normalizeObjectPath(path) {
  const segments = String(path || "").replace(/^\/+|\/+$/g, "").split("/");
  if (!segments.length || segments.length > 8 || segments.some(segment =>
    !segment || segment === "." || segment === ".." || !/^[a-z0-9._-]+$/i.test(segment)
  )) throw new Error("La ruta de la fotografía no es válida.");
  return segments.join("/");
}

function mediaUrl(path) {
  const config = window.CATALOG_CONFIG || {};
  const host = String(window.location.hostname || "").toLowerCase();
  const isPreviewHost = host.endsWith(".jb-collections.pages.dev") &&
    host !== "jb-collections.pages.dev";
  const base = String(
    isPreviewHost ? window.location.origin : (config.publicCatalogUrl || window.location.origin)
  ).replace(/\/+$/, "");
  return base + "/media/" + normalizeObjectPath(path).split("/").map(encodeURIComponent).join("/");
}

function storageError(message, status = 500) {
  const error = new Error(message || "No se pudo completar la operación de almacenamiento.");
  error.status = status;
  return error;
}

async function adminRequest(client, url, options = {}) {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw storageError("La sesión administrativa expiró.", 401);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: "Bearer " + token,
      "Cache-Control": "no-store"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw storageError(payload.error || "No se pudo completar la operación.", response.status);
  return payload;
}

function createStorageAdapter(client) {
  return {
    from(bucket) {
      if (String(bucket) !== "product-images") {
        throw new Error("Solo está habilitado el bucket de imágenes de JB Collections.");
      }
      return {
        async info(path) {
          try {
            const safePath = normalizeObjectPath(path);
            const payload = await adminRequest(client, "/api/storage/info?path=" + encodeURIComponent(safePath));
            return { data: payload.data || null, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        async remove(paths) {
          try {
            if (!Array.isArray(paths) || !paths.length) return { data: [], error: null };
            const safePaths = paths.map(normalizeObjectPath);
            const payload = await adminRequest(client, "/api/storage/remove", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths: safePaths })
            });
            return { data: payload.data || [], error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        getPublicUrl(path) {
          try {
            return { data: { publicUrl: mediaUrl(path) } };
          } catch (error) {
            return { data: { publicUrl: "" }, error };
          }
        }
      };
    }
  };
}

export function createCatalogClient({ admin = false } = {}) {
  const config = window.CATALOG_CONFIG || {};
  if (!config.neonAuthUrl || !config.neonDataApiUrl) return null;
  const auth = { url: config.neonAuthUrl, allowAnonymous: true };
  if (admin) auth.adapter = SupabaseAuthAdapter();
  const client = createClient({
    auth,
    dataApi: { url: config.neonDataApiUrl }
  });
  client.storage = createStorageAdapter(client);
  client.__jbNeonSdkVersion = SDK_VERSION;
  return client;
}

/**
 * Request a one-time password-reset code from Neon Auth.
 * Used by the owner when activating or resetting an invited account.
 */
export async function requestCatalogPasswordReset(email) {
  const address = String(email || "").trim().toLowerCase();
  if (!address) throw new Error("Ingresá el correo autorizado.");
  const client = createCatalogClient({ admin: true });
  const auth = client?.auth?.getBetterAuthInstance?.();
  if (!auth?.emailOtp?.requestPasswordReset) {
    throw new Error("El restablecimiento por código no está disponible en este cliente de Neon.");
  }
  const result = await auth.emailOtp.requestPasswordReset({ email: address });
  if (result?.error) throw result.error;
  return true;
}

/**
 * Complete an owner-managed OTP password setup/reset for an invited account.
 * This is not exposed from the public login form.
 */
export async function completeCatalogPasswordReset(email, otp, password) {
  const address = String(email || "").trim().toLowerCase();
  const code = String(otp || "").trim();
  const newPassword = String(password || "");
  if (!address || !/^\d{6}$/.test(code)) throw new Error("El código de correo debe tener seis dígitos.");
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new Error("La contraseña debe tener entre 8 y 128 caracteres.");
  }
  const client = createCatalogClient({ admin: true });
  const auth = client?.auth?.getBetterAuthInstance?.();
  if (!auth?.emailOtp?.resetPassword) {
    throw new Error("El cambio de contraseña por código no está disponible en este cliente de Neon.");
  }
  const result = await auth.emailOtp.resetPassword({
    email: address,
    otp: code,
    password: newPassword
  });
  if (result?.error) throw result.error;
  if (result?.data?.success === false) throw new Error("El código no pudo validarse o ya venció.");
  return true;
}
