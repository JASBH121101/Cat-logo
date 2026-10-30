package com.jbcollections.manager.v2;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

@CapacitorPlugin(name = "GoPartnersScanner")
public class GoPartnersScannerPlugin extends Plugin {
    private static final String PREFS = "jb_go_partners_screen_scan";
    private static final String ACTION_START = "com.jbcollections.manager.v2.GP_SCAN_START";
    private static final String ACTION_STOP = "com.jbcollections.manager.v2.GP_SCAN_STOP";
    private static final String EXTRA_RESULT_CODE = "projection_result_code";
    private static final String EXTRA_RESULT_DATA = "projection_result_data";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void startScan(PluginCall call) {
        if (isRunning()) {
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
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
            Intent service = new Intent(getContext(), GoPartnersCaptureService.class);
            service.setAction(ACTION_START);
            service.putExtra(EXTRA_RESULT_CODE, result.getResultCode());
            service.putExtra(EXTRA_RESULT_DATA, result.getData());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(service);
            else getContext().startService(service);
            JSObject started = new JSObject();
            started.put("started", true);
            started.put("message", "Permiso concedido. La captura local está iniciándose.");
            call.resolve(started);
        } catch (Exception error) {
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
        requestStop();
        resolveWhenStopped(call, 0);
    }

    private void resolveWhenStopped(PluginCall call, int attempt) {
        if (call == null) return;
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean running = prefs.getBoolean("running", false);
        boolean processing = prefs.getBoolean("processing", false);
        if ((!running && !processing) || attempt >= 24) {
            call.resolve(sessionState());
            return;
        }
        mainHandler.postDelayed(() -> resolveWhenStopped(call, attempt + 1), 250);
    }

    @PluginMethod
    public void clearScan(PluginCall call) {
        if (isRunning()) {
            call.reject("Primero detené la captura antes de borrar la sesión.");
            return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean("processing", false)) {
            call.reject("El OCR local todavía está terminando de procesar la última pantalla.");
            return;
        }
        prefs.edit().clear().apply();
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }

    private void requestStop() {
        try {
            Intent stop = new Intent(getContext(), GoPartnersCaptureService.class);
            stop.setAction(ACTION_STOP);
            getContext().startService(stop);
        } catch (Exception ignored) {
            getContext().stopService(new Intent(getContext(), GoPartnersCaptureService.class));
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("running", false).apply();
        }
    }

    private boolean isRunning() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("running", false);
    }

    private JSObject sessionState() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject state = new JSObject();
        state.put("running", prefs.getBoolean("running", false));
        state.put("processing", prefs.getBoolean("processing", false));
        state.put("truncated", prefs.getBoolean("truncated", false));
        state.put("observationsCount", prefs.getInt("observations_count", 0));
        try {
            state.put("observations", new JSONArray(prefs.getString("observations", "[]")));
        } catch (Exception ignored) {
            state.put("observations", new JSONArray());
        }
        return state;
    }

    private String safeMessage(Exception error) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.trim().isEmpty()) return "error desconocido";
        return message.substring(0, Math.min(180, message.length()));
    }
}
