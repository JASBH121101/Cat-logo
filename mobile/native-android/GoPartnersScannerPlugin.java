package com.jbcollections.manager.v2;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "GoPartnersScanner")
public class GoPartnersScannerPlugin extends Plugin {
    private static final String ACTION_START = "com.jbcollections.manager.v2.GP_SCAN_START";
    private static final String ACTION_STOP = "com.jbcollections.manager.v2.GP_SCAN_STOP";
    private static final String EXTRA_RESULT_CODE = "projection_result_code";
    private static final String EXTRA_RESULT_DATA = "projection_result_data";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void hasOverlayPermission(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            Settings.canDrawOverlays(getContext());
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext())) {
            JSObject result = new JSObject();
            result.put("opened", false);
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        try {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            );
            getActivity().startActivity(settings);
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("granted", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudieron abrir los permisos de ventana flotante: " + safeMessage(error),
                "OVERLAY_SETTINGS_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(getContext())) {
            JSObject permission = new JSObject();
            permission.put("started", false);
            permission.put("overlayPermissionRequired", true);
            permission.put("message", "Primero habilitá Mostrar sobre otras aplicaciones para usar el control flotante de JARVIS.");
            call.resolve(permission);
            return;
        }
        if (GoPartnersScanSession.isRunning()) {
            JSObject state = sessionState();
            state.put("started", true);
            state.put("alreadyRunning", true);
            call.resolve(state);
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager)
            getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("Android no ofrece el servicio de captura de pantalla en este dispositivo.");
            return;
        }
        startActivityForResult(call, manager.createScreenCaptureIntent(), "projectionPermissionResult");
    }

    @ActivityCallback
    private void projectionPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject denied = new JSObject();
            denied.put("started", false);
            denied.put("message", "No se concedió el permiso de captura de pantalla.");
            call.resolve(denied);
            return;
        }
        try {
            GoPartnersScanSession.reset();
            Intent service = new Intent(getContext(), GoPartnersCaptureService.class);
            service.setAction(ACTION_START);
            service.putExtra(EXTRA_RESULT_CODE, result.getResultCode());
            service.putExtra(EXTRA_RESULT_DATA, result.getData());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(service);
            else getContext().startService(service);
            Intent overlay = new Intent(getContext(), GoPartnersOverlayService.class);
            overlay.setAction(GoPartnersOverlayService.ACTION_SHOW);
            getContext().startService(overlay);
            JSObject started = new JSObject();
            started.put("started", true);
            started.put("message", "Permiso concedido. La captura local y el control flotante están iniciándose.");
            call.resolve(started);
        } catch (Exception error) {
            try {
                Intent stop = new Intent(getContext(), GoPartnersCaptureService.class);
                stop.setAction(ACTION_STOP);
                getContext().startService(stop);
            } catch (Exception ignored) {
                getContext().stopService(new Intent(getContext(), GoPartnersCaptureService.class));
            }
            hideOverlayControls();
            GoPartnersScanSession.setFlags(false, false);
            JSObject failed = new JSObject();
            failed.put("started", false);
            failed.put("message", "No se pudo iniciar el escáner: " + safeMessage(error));
            call.resolve(failed);
        }
    }

    @PluginMethod
    public void getScanState(PluginCall call) {
        call.resolve(sessionState());
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        GoPartnersScanSession.clearFinishRequest();
        requestStop();
        hideOverlayControls();
        resolveWhenStopped(call, 0);
    }

    @PluginMethod
    public void hideOverlayControls(PluginCall call) {
        hideOverlayControls();
        JSObject result = new JSObject();
        result.put("hidden", true);
        call.resolve(result);
    }

    private void hideOverlayControls() {
        try { getContext().stopService(new Intent(getContext(), GoPartnersOverlayService.class)); }
        catch (Exception ignored) {}
    }

    private void resolveWhenStopped(PluginCall call, int attempt) {
        if (call == null) return;
        if ((!GoPartnersScanSession.isRunning() && !GoPartnersScanSession.isProcessing()) || attempt >= 24) {
            call.resolve(sessionState());
            return;
        }
        mainHandler.postDelayed(() -> resolveWhenStopped(call, attempt + 1), 250);
    }

    @PluginMethod
    public void clearScan(PluginCall call) {
        if (GoPartnersScanSession.isRunning() || GoPartnersScanSession.isProcessing()) {
            call.reject("Primero detené la captura y esperá a que termine el OCR.");
            return;
        }
        GoPartnersScanSession.reset();
        hideOverlayControls();
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }

    private void requestStop() {
        if (!GoPartnersScanSession.isRunning() && !GoPartnersScanSession.isProcessing()) return;
        try {
            Intent stop = new Intent(getContext(), GoPartnersCaptureService.class);
            stop.setAction(ACTION_STOP);
            getContext().startService(stop);
        } catch (Exception ignored) {
            getContext().stopService(new Intent(getContext(), GoPartnersCaptureService.class));
            GoPartnersScanSession.setFlags(false, false);
        }
    }

    private JSObject sessionState() {
        JSONObject snapshot = GoPartnersScanSession.snapshot();
        JSObject state = new JSObject();
        state.put("running", snapshot.optBoolean("running", false));
        state.put("processing", snapshot.optBoolean("processing", false));
        state.put("truncated", snapshot.optBoolean("truncated", false));
        state.put("interrupted", snapshot.optBoolean("interrupted", false));
        state.put("finishRequested", snapshot.optBoolean("finishRequested", false));
        state.put("overlayVisible", snapshot.optBoolean("overlayVisible", false));
        state.put("overlayError", snapshot.optString("overlayError", ""));
        state.put("interruptionReason", snapshot.optString("interruptionReason", ""));
        state.put("observationsCount", snapshot.optInt("observationsCount", 0));
        JSONArray observations = snapshot.optJSONArray("observations");
        state.put("observations", observations == null ? new JSONArray() : observations);
        return state;
    }

    private String safeMessage(Exception error) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.trim().isEmpty()) return "error desconocido";
        return message.substring(0, Math.min(180, message.length()));
    }
}
