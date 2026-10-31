package com.jbcollections.manager.v2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public final class GoPartnersScanSession {
    private static final Object LOCK = new Object();
    private static final int MAX_OBSERVATIONS = 80;
    private static JSONArray observations = new JSONArray();
    private static boolean running = false;
    private static boolean processing = false;
    private static boolean truncated = false;
    private static boolean interrupted = false;
    private static boolean finishRequested = false;
    private static boolean overlayVisible = false;
    private static String overlayError = "";
    private static String interruptionReason = "";

    private GoPartnersScanSession() {}

    public static void reset() {
        synchronized (LOCK) {
            observations = new JSONArray();
            running = false;
            processing = false;
            truncated = false;
            interrupted = false;
            finishRequested = false;
            overlayVisible = false;
            overlayError = "";
            interruptionReason = "";
        }
    }

    public static void requestFinishFromOverlay() {
        synchronized (LOCK) { finishRequested = true; }
    }

    public static void clearFinishRequest() {
        synchronized (LOCK) { finishRequested = false; }
    }

    public static void setOverlayVisible(boolean visible) {
        synchronized (LOCK) { overlayVisible = visible; }
    }

    public static void setOverlayError(String error) {
        synchronized (LOCK) {
            overlayVisible = false;
            overlayError = error == null ? "" : error.trim();
        }
    }

    public static void markInterrupted(String reason) {
        synchronized (LOCK) {
            interrupted = true;
            interruptionReason = reason == null ? "" : reason.trim();
        }
    }

    public static void setFlags(boolean isRunning, boolean isProcessing) {
        synchronized (LOCK) {
            running = isRunning;
            processing = isProcessing;
        }
    }

    public static boolean isRunning() {
        synchronized (LOCK) { return running; }
    }

    public static boolean isProcessing() {
        synchronized (LOCK) { return processing; }
    }

    public static void appendObservation(String text, long capturedAt) {
        if (text == null || text.trim().length() < 8) return;
        synchronized (LOCK) {
            if (!running && !processing) return;
            if (observations.length() >= MAX_OBSERVATIONS) {
                truncated = true;
                return;
            }
            try {
                JSONObject item = new JSONObject();
                item.put("index", observations.length() + 1);
                item.put("capturedAt", isoDate(capturedAt));
                item.put("text", text);
                observations.put(item);
            } catch (JSONException ignored) {
            }
        }
    }

    public static JSONObject snapshot() {
        synchronized (LOCK) {
            JSONObject result = new JSONObject();
            try {
                result.put("running", running);
                result.put("processing", processing);
                result.put("truncated", truncated);
                result.put("interrupted", interrupted);
                result.put("finishRequested", finishRequested);
                result.put("overlayVisible", overlayVisible);
                result.put("overlayError", overlayError);
                result.put("interruptionReason", interruptionReason);
                result.put("observationsCount", observations.length());
                result.put("observations", new JSONArray(observations.toString()));
            } catch (JSONException ignored) {
            }
            return result;
        }
    }

    private static String isoDate(long time) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(time));
    }
}
