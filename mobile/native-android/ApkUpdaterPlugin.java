package com.jbcollections.manager.v2;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
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

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", ""), version = call.getString("version", "");
        if (!VERSION_PATTERN.matcher(version).matches()) { call.reject("La versión de actualización no es válida."); return; }
        Uri parsed = Uri.parse(url);
        String expectedPath = "/JASBH121101/Cat-logo/releases/download/jb-manager-v" + version + "/JB-Manager-Collections.apk";
        if (!"https".equalsIgnoreCase(parsed.getScheme()) || !"github.com".equalsIgnoreCase(parsed.getHost()) || !expectedPath.equals(parsed.getPath())) {
            call.reject("Por seguridad, solo se permiten APK de las publicaciones oficiales de JB Collections."); return;
        }
        SharedPreferences store = prefs();
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
        if (!canInstall()) {
            try { openPermissionSettings(); call.resolve(permissionResult()); }
            catch (Exception e) { call.reject("Android necesita permiso para instalar aplicaciones desde JB Manager Collections.", e); }
            return;
        }
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
            if (raw == DownloadManager.STATUS_SUCCESSFUL && dm != null && dm.getUriForDownloadedFile(id) == null) {
                out.put("status", "failed"); out.put("error", "Android marcó la descarga como completa, pero no encontró el archivo.");
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
        if (file == null || !file.isFile() || file.length() < 1000000L) throw new IllegalStateException("el archivo está incompleto o no se encuentra");
        PackageManager pm = getContext().getPackageManager();
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), 0);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) throw new IllegalStateException("el archivo recibido no es una APK válida de JB Manager Collections");
        if (!expectedVersion.equals(archive.versionName)) throw new IllegalStateException("la versión del APK no coincide con la solicitada");
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
