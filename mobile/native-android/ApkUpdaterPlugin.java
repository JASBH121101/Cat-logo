package com.jbcollections.manager.v2;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import java.security.MessageDigest;
import java.util.Arrays;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.List;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    private static final String PREFS = "jb_manager_native_apk_update";
    private static final String ID = "download_id", VERSION = "version", FILENAME = "filename", PROMPTED = "install_prompted";
    private static final String MIME = "application/vnd.android.package-archive";
    private static final String EXPECTED_PACKAGE = "com.jbcollections.manager.v2";
    private static final Pattern VERSION_PATTERN = Pattern.compile("^\\d+\\.\\d+\\.\\d+$");
    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private DownloadManager manager() { return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE); }
    private boolean canInstall() { return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls(); }
    private void openPermissionSettings() {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
    }
    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put("permissionRequired", true);
        result.put("status", "permission-required");
        return result;
    }
    private File fileFor(String name) {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return dir == null ? null : new File(dir, name);
    }
    private Cursor query(long id) {
        DownloadManager dm = manager();
        if (dm == null || id <= 0) return null;
        try { return dm.query(new DownloadManager.Query().setFilterById(id)); } catch (Exception e) { return null; }
    }
    private int status(long id) {
        Cursor c = query(id);
        if (c == null) return -1;
        try { return c.moveToFirst() ? c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) : -1; }
        catch (Exception e) { return -1; } finally { c.close(); }
    }
    private String filename(String version) { return "JB-Manager-Collections-v" + version + ".apk"; }

    private int compareVersions(String left, String right) {
        String[] a = left.split("\\.");
        String[] b = right.split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            long av = i < a.length ? parseVersionPart(a[i]) : 0L;
            long bv = i < b.length ? parseVersionPart(b[i]) : 0L;
            if (av != bv) return Long.compare(av, bv);
        }
        return 0;
    }

    private long parseVersionPart(String value) {
        try { return Long.parseLong(value); }
        catch (NumberFormatException ignored) { return 0L; }
    }

    // Remove persisted DownloadManager state once the installed APK is at least
    // as new as the downloaded version. If installation was cancelled and the
    // installed version is older, keep the completed APK available for manual retry.
    private void clearObsoleteDownloadIfInstalledVersionIsNewer(SharedPreferences store) {
        String savedVersion = store.getString(VERSION, "");
        if (!VERSION_PATTERN.matcher(savedVersion).matches()) return;
        try {
            PackageInfo installed = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            String installedVersion = installed.versionName == null ? "" : installed.versionName;
            if (!VERSION_PATTERN.matcher(installedVersion).matches()
                || compareVersions(savedVersion, installedVersion) > 0) return;

            long staleId = store.getLong(ID, -1);
            DownloadManager dm = manager();
            if (dm != null && staleId > 0) {
                try { dm.remove(staleId); } catch (Exception ignored) {}
            }
            String staleName = store.getString(FILENAME, filename(savedVersion));
            File staleFile = fileFor(staleName);
            if (staleFile != null && staleFile.exists()) {
                try { staleFile.delete(); } catch (Exception ignored) {}
            }
            store.edit().remove(ID).remove(VERSION).remove(FILENAME).remove(PROMPTED).apply();
        } catch (Exception ignored) {
            // Never block normal startup because optional stale-state cleanup failed.
        }
    }

    private void validateDownloadedApk(File file, String expectedVersion, long downloadId) throws Exception {
        if (file == null || !file.isFile() || file.length() < 1024L) {
            throw new IllegalStateException("el archivo de actualización está vacío o incompleto");
        }
        DownloadManager dm = manager();
        Cursor cursor = query(downloadId);
        if (dm == null || cursor == null) throw new IllegalStateException("Android no confirmó el estado final de la descarga");
        try {
            if (!cursor.moveToFirst() || cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) != DownloadManager.STATUS_SUCCESSFUL) {
                throw new IllegalStateException("Android todavía no confirma que el APK esté completo");
            }
            long expectedBytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            long downloadedBytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            if (expectedBytes <= 0 || downloadedBytes != expectedBytes || file.length() != expectedBytes) {
                throw new IllegalStateException("El tamaño final no coincide con los bytes confirmados por Android");
            }
        } finally { cursor.close(); }

        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (archive == null || !EXPECTED_PACKAGE.equals(archive.packageName)) {
            throw new IllegalStateException("El archivo recibido no es una APK válida de JB Manager Collections");
        }
        if (!expectedVersion.equals(archive.versionName)) {
            throw new IllegalStateException("La versión del APK no coincide con la versión solicitada");
        }
        PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), flags);
        Signature[] installedSigs;
        Signature[] archiveSigs;
        if (Build.VERSION.SDK_INT >= 28) {
            if (installed.signingInfo == null || archive.signingInfo == null) {
                throw new IllegalStateException("No se pudieron validar los certificados de la APK");
            }
            installedSigs = installed.signingInfo.getApkContentsSigners();
            archiveSigs = archive.signingInfo.getApkContentsSigners();
        } else {
            installedSigs = installed.signatures;
            archiveSigs = archive.signatures;
        }
        byte[][] installedHashes = signatureHashes(installedSigs);
        byte[][] archiveHashes = signatureHashes(archiveSigs);
        if (!sameHashSet(installedHashes, archiveHashes)) {
            throw new IllegalStateException("El certificado del APK no coincide con la aplicación instalada");
        }
    }

    private byte[][] signatureHashes(Signature[] signatures) throws Exception {
        if (signatures == null || signatures.length == 0) return new byte[0][];
        byte[][] hashes = new byte[signatures.length][];
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (int i = 0; i < signatures.length; i++) hashes[i] = digest.digest(signatures[i].toByteArray());
        return hashes;
    }

    private boolean sameHashSet(byte[][] left, byte[][] right) {
        if (left.length == 0 || left.length != right.length) return false;
        boolean[] used = new boolean[right.length];
        for (byte[] expected : left) {
            boolean found = false;
            for (int i = 0; i < right.length; i++) {
                if (!used[i] && Arrays.equals(expected, right[i])) {
                    used[i] = true;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", ""), version = call.getString("version", "");
        if (!VERSION_PATTERN.matcher(version).matches()) { call.reject("La versión de actualización no es válida."); return; }
        Uri parsed = Uri.parse(url);
        String expectedPath = "/JASBH121101/Cat-logo/releases/download/jb-manager-v" + version + "/JB-Manager-Collections.apk";
        boolean officialGithubRelease = "https".equalsIgnoreCase(parsed.getScheme())
            && "github.com".equalsIgnoreCase(parsed.getHost())
            && expectedPath.equals(parsed.getPath())
            && parsed.getQuery() == null;
        String expectedProxyUrl = "https://jb-collections.pages.dev/api/download/apk?version=" + Uri.encode(version);
        boolean officialCloudflareProxy = expectedProxyUrl.equals(url);
        if (!officialGithubRelease && !officialCloudflareProxy) {
            call.reject("Por seguridad, solo se permiten APK de las publicaciones oficiales de JB Collections."); return;
        }
        SharedPreferences store = prefs();
        clearObsoleteDownloadIfInstalledVersionIsNewer(store);
        long oldId = store.getLong(ID, -1);
        if (oldId > 0 && version.equals(store.getString(VERSION, ""))) {
            int oldStatus = status(oldId);
            if (oldStatus == DownloadManager.STATUS_PENDING || oldStatus == DownloadManager.STATUS_RUNNING || oldStatus == DownloadManager.STATUS_PAUSED) {
                JSObject out = new JSObject(); out.put("downloadId", oldId); out.put("version", version); out.put("status", "running"); out.put("alreadyRunning", true); call.resolve(out); return;
            }
            if (oldStatus == DownloadManager.STATUS_SUCCESSFUL) {
                if (!canInstall()) {
                    try { openPermissionSettings(); call.resolve(permissionResult()); }
                    catch (Exception e) { call.reject("Android necesita permiso para instalar aplicaciones desde JB Manager Collections.", e); }
                    return;
                }
                try { launchInstaller(oldId, version); JSObject out = new JSObject(); out.put("downloadId", oldId); out.put("version", version); out.put("status", "installer-launched"); out.put("installerLaunched", true); call.resolve(out); }
                catch (Exception e) { call.reject("La descarga terminó, pero no se pudo abrir el instalador: " + e.getMessage(), e); }
                return;
            }
            try { DownloadManager dm = manager(); if (dm != null) dm.remove(oldId); } catch (Exception ignored) {}
        }
        // Downloading is allowed without install-package permission. Android
        // will request that permission only when the completed APK is opened.
        DownloadManager dm = manager();
        if (dm == null) { call.reject("Android no tiene disponible el administrador de descargas."); return; }
        String name = filename(version);
        File dest = fileFor(name);
        if (dest == null) { call.reject("Android no pudo preparar la carpeta de actualización."); return; }
        if (dest.exists() && !dest.delete()) { call.reject("No se pudo reemplazar un APK anterior. Revisá el espacio disponible."); return; }
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("JB Manager Collections · v" + version);
            request.setDescription("Descargando actualización oficial…");
            request.setMimeType(MIME);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, name);
            long id = dm.enqueue(request);
            store.edit().putLong(ID, id).putString(VERSION, version).putString(FILENAME, name).putBoolean(PROMPTED, false).apply();
            JSObject out = new JSObject(); out.put("downloadId", id); out.put("version", version); out.put("status", "queued"); out.put("alreadyRunning", false); call.resolve(out);
        } catch (Exception e) { call.reject("No se pudo iniciar la descarga nativa de Android: " + e.getMessage(), e); }
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        SharedPreferences store = prefs();
        clearObsoleteDownloadIfInstalledVersionIsNewer(store);
        long id = store.getLong(ID, -1);
        JSObject out = new JSObject();
        out.put("downloadId", id); out.put("version", store.getString(VERSION, "")); out.put("filename", store.getString(FILENAME, ""));
        out.put("installPrompted", store.getBoolean(PROMPTED, false));
        if (id <= 0) { out.put("status", "idle"); call.resolve(out); return; }
        DownloadManager dm = manager(); Cursor c = query(id);
        if (c == null) { out.put("status", "unknown"); call.resolve(out); return; }
        try {
            if (!c.moveToFirst()) { out.put("status", "unknown"); call.resolve(out); return; }
            int raw = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            int bytes = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            int total = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            String state = raw == DownloadManager.STATUS_PENDING ? "pending" : raw == DownloadManager.STATUS_RUNNING ? "running" : raw == DownloadManager.STATUS_PAUSED ? "paused" : raw == DownloadManager.STATUS_SUCCESSFUL ? "successful" : raw == DownloadManager.STATUS_FAILED ? "failed" : "unknown";
            out.put("status", state); out.put("bytesDownloaded", bytes); out.put("totalBytes", total); out.put("reason", reason);
            if (raw == DownloadManager.STATUS_SUCCESSFUL && dm != null) {
                File local = fileFor(store.getString(FILENAME, filename(store.getString(VERSION, ""))));
                try {
                    validateDownloadedApk(local, store.getString(VERSION, ""), id);
                    out.put("verified", true);
                } catch (Exception validationError) {
                    out.put("status", "failed");
                    out.put("error", validationError.getMessage() == null ? "No se pudo validar el APK completado." : validationError.getMessage());
                }
            }
            call.resolve(out);
        } catch (Exception e) { call.reject("No se pudo consultar el estado de descarga: " + e.getMessage(), e); }
        finally { c.close(); }
    }

    @PluginMethod
    public void installDownloadedApk(PluginCall call) {
        long id = prefs().getLong(ID, -1);
        String version = prefs().getString(VERSION, "");
        if (id <= 0 || version.isEmpty()) { call.reject("No hay una actualización descargada para instalar."); return; }
        if (status(id) != DownloadManager.STATUS_SUCCESSFUL) { call.reject("Android todavía no ha confirmado que el APK esté completo."); return; }
        if (!canInstall()) {
            try { openPermissionSettings(); call.resolve(permissionResult()); }
            catch (Exception e) { call.reject("Android necesita permiso para instalar desde JB Manager Collections.", e); }
            return;
        }
        try { launchInstaller(id, version); JSObject out = new JSObject(); out.put("installerLaunched", true); out.put("version", version); out.put("status", "installer-launched"); call.resolve(out); }
        catch (Exception e) { call.reject("El APK se descargó, pero no se pudo abrir el instalador: " + e.getMessage(), e); }
    }

    private void launchInstaller(long id, String expectedVersion) throws Exception {
        DownloadManager dm = manager();
        if (dm == null) throw new IllegalStateException("el administrador de descargas no está disponible");
        File file = fileFor(prefs().getString(FILENAME, filename(expectedVersion)));
        validateDownloadedApk(file, expectedVersion, id);
        PackageManager pm = getContext().getPackageManager();
        Uri uri = dm.getUriForDownloadedFile(id);
        if (uri == null) throw new IllegalStateException("Android no proporcionó un enlace seguro al APK");
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, MIME);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        List<ResolveInfo> handlers = pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo info : handlers) if (info.activityInfo != null) getContext().grantUriPermission(info.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(intent);
        prefs().edit().putBoolean(PROMPTED, true).apply();
    }
}
