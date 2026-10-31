package com.jbcollections.manager.v2;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "JbVoiceInput",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class JbVoiceInputPlugin extends Plugin implements RecognitionListener {
    private SpeechRecognizer recognizer;
    private boolean listening = false;

    @PluginMethod
    public void checkPermission(PluginCall call) {
        call.resolve(permissionState());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve(permissionState());
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (call != null) call.resolve(permissionState());
    }

    private JSObject permissionState() {
        boolean granted = getPermissionState("microphone") == PermissionState.GRANTED;
        boolean rationale = false;
        try {
            rationale = ActivityCompat.shouldShowRequestPermissionRationale(
                getActivity(), Manifest.permission.RECORD_AUDIO);
        } catch (Exception ignored) {}
        JSObject result = new JSObject();
        result.put("granted", granted);
        result.put("shouldShowRationale", rationale);
        return result;
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Android no concedió el permiso del micrófono.", "MICROPHONE_PERMISSION_REQUIRED");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("No hay un servicio de reconocimiento de voz disponible en Android.", "VOICE_RECOGNIZER_UNAVAILABLE");
            return;
        }

        String language = call.getString("language", "es-NI");
        getActivity().runOnUiThread(() -> {
            try {
                destroyRecognizer();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                if (recognizer == null) {
                    call.reject("Android no pudo crear el servicio de reconocimiento de voz.", "VOICE_RECOGNIZER_UNAVAILABLE");
                    return;
                }
                recognizer.setRecognitionListener(this);
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language == null || language.trim().isEmpty() ? "es-NI" : language);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language == null || language.trim().isEmpty() ? "es-NI" : language);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                recognizer.startListening(intent);
                listening = true;
                JSObject result = new JSObject();
                result.put("started", true);
                call.resolve(result);
            } catch (Exception error) {
                listening = false;
                destroyRecognizer();
                call.reject("No se pudo iniciar el reconocimiento de voz: " + safeMessage(error), "VOICE_START_FAILED");
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (recognizer != null && listening) recognizer.stopListening();
                else listening = false;
                JSObject result = new JSObject();
                result.put("stopped", true);
                call.resolve(result);
            } catch (Exception error) {
                listening = false;
                call.reject("No se pudo detener el reconocimiento de voz: " + safeMessage(error));
            }
        });
    }

    @PluginMethod
    public void cancelListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (recognizer != null) recognizer.cancel();
                listening = false;
                JSObject result = new JSObject();
                result.put("cancelled", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("No se pudo cancelar el reconocimiento de voz: " + safeMessage(error));
            }
        });
    }

    private void emitTranscript(String eventName, Bundle bundle) {
        if (bundle == null) return;
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return;
        String transcript = matches.get(0);
        if (transcript == null || transcript.trim().isEmpty()) return;
        JSObject payload = new JSObject();
        payload.put("transcript", transcript.trim());
        notifyListeners(eventName, payload);
    }

    private String errorCode(int error) {
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return "permission";
        if (error == SpeechRecognizer.ERROR_AUDIO) return "audio";
        if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) return "network";
        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) return "no_match";
        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) return "busy";
        if (error == SpeechRecognizer.ERROR_SERVER || error == SpeechRecognizer.ERROR_CLIENT) return "unavailable";
        return "unknown";
    }

    @Override public void onReadyForSpeech(Bundle params) {
        JSObject payload = new JSObject();
        payload.put("ready", true);
        notifyListeners("listening", payload);
    }

    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rmsdB) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}

    @Override public void onError(int error) {
        listening = false;
        JSObject payload = new JSObject();
        payload.put("code", errorCode(error));
        payload.put("androidErrorCode", error);
        notifyListeners("recognitionError", payload);
    }

    @Override public void onResults(Bundle results) {
        listening = false;
        emitTranscript("result", results);
    }

    @Override public void onPartialResults(Bundle partialResults) {
        emitTranscript("partialResult", partialResults);
    }

    @Override public void onEvent(int eventType, Bundle params) {}

    private void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
        listening = false;
    }

    private String safeMessage(Exception error) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.trim().isEmpty()) return "error desconocido";
        return message.substring(0, Math.min(160, message.length()));
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        super.handleOnDestroy();
    }
}
