package com.jbcollections.manager.v2;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

/**
 * Optional biometric app lock for JB Manager.
 *
 * Android performs biometric matching inside the system. This plugin stores
 * only the user's enabled/disabled preference; it never reads or stores
 * fingerprint templates, biometric images, or passwords.
 */
@CapacitorPlugin(name = "JbBiometricAuth")
public class JbBiometricAuthPlugin extends Plugin {
    private static final String PREFS = "jb_manager_biometric_auth";
    private static final String KEY_ENABLED = "biometric_unlock_enabled";
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        int resultCode = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        JSObject result = new JSObject();
        result.put("available", resultCode == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("enabled", preferences().getBoolean(KEY_ENABLED, false));
        result.put("code", resultCode);
        result.put("message", availabilityMessage(resultCode));
        call.resolve(result);
    }

    @PluginMethod
    public void enable(PluginCall call) {
        if (!requireBiometricHardware(call)) return;
        authenticate(call, true);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        if (!preferences().getBoolean(KEY_ENABLED, false)) {
            call.reject("El desbloqueo con huella no está activado.", "BIOMETRIC_NOT_ENABLED");
            return;
        }
        if (!requireBiometricHardware(call)) return;
        authenticate(call, false);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        preferences().edit().putBoolean(KEY_ENABLED, false).apply();
        JSObject result = new JSObject();
        result.put("enabled", false);
        call.resolve(result);
    }

    @PluginMethod
    public void openEnrollmentSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                intent = new Intent(Settings.ACTION_BIOMETRIC_ENROLL);
                intent.putExtra(
                    Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                    AUTHENTICATORS
                );
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "No se pudieron abrir los ajustes de huella/biometría: " + safeMessage(error),
                "BIOMETRIC_SETTINGS_UNAVAILABLE"
            );
        }
    }

    private boolean requireBiometricHardware(PluginCall call) {
        int resultCode = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        if (resultCode == BiometricManager.BIOMETRIC_SUCCESS) return true;

        String code = resultCode == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
            ? "BIOMETRIC_NONE_ENROLLED"
            : resultCode == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
                ? "BIOMETRIC_NO_HARDWARE"
                : resultCode == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE
                    ? "BIOMETRIC_HARDWARE_UNAVAILABLE"
                    : "BIOMETRIC_UNAVAILABLE";

        call.reject(availabilityMessage(resultCode), code);
        return false;
    }

    private String availabilityMessage(int resultCode) {
        if (resultCode == BiometricManager.BIOMETRIC_SUCCESS) {
            return "La autenticación biométrica está disponible.";
        }
        if (resultCode == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) {
            return "No hay huellas o biometría configuradas. Registrá una en los ajustes de Android.";
        }
        if (resultCode == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) {
            return "Este dispositivo no tiene un sensor biométrico compatible.";
        }
        if (resultCode == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE) {
            return "El sensor biométrico no está disponible en este momento.";
        }
        if (resultCode == BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED) {
            return "Android necesita una actualización de seguridad antes de permitir esta autenticación.";
        }
        return "La autenticación biométrica no está disponible en este dispositivo.";
    }

    private void authenticate(PluginCall call, boolean enableAfterSuccess) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("JB Manager no está en primer plano para solicitar la huella.", "BIOMETRIC_ACTIVITY_UNAVAILABLE");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(activity);
                BiometricPrompt prompt = new BiometricPrompt(
                    activity,
                    executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            if (enableAfterSuccess) {
                                preferences().edit().putBoolean(KEY_ENABLED, true).apply();
                            }
                            JSObject response = new JSObject();
                            response.put("authenticated", true);
                            response.put("enabled", enableAfterSuccess || preferences().getBoolean(KEY_ENABLED, false));
                            call.resolve(response);
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence errString) {
                            String message = errString == null
                                ? "No se pudo verificar la huella."
                                : errString.toString();
                            String code = errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                ? "BIOMETRIC_PASSWORD_FALLBACK"
                                : errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                                  errorCode == BiometricPrompt.ERROR_CANCELED
                                    ? "BIOMETRIC_CANCELED"
                                    : "BIOMETRIC_AUTHENTICATION_FAILED";
                            call.reject(message, code);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // The system prompt remains open so the user can retry.
                        }
                    }
                );

                BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(enableAfterSuccess ? "Activar huella en JB Manager" : "Desbloquear JB Manager")
                    .setSubtitle("Confirmá tu identidad con la biometría registrada en Android.")
                    .setNegativeButtonText("Usar contraseña")
                    .setAllowedAuthenticators(AUTHENTICATORS)
                    .build();

                prompt.authenticate(promptInfo);
            } catch (Exception error) {
                call.reject(
                    "No se pudo abrir la verificación biométrica: " + safeMessage(error),
                    "BIOMETRIC_PROMPT_FAILED"
                );
            }
        });
    }

    private String safeMessage(Exception error) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.trim().isEmpty()) return "error desconocido";
        return message.substring(0, Math.min(180, message.length()));
    }
}
