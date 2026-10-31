package com.jbcollections.manager.v2;

import android.app.ActivityOptions;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.TextView;

public class GoPartnersOverlayService extends Service {
    public static final String ACTION_SHOW = "com.jbcollections.manager.v2.GP_OVERLAY_SHOW";
    public static final String ACTION_HIDE = "com.jbcollections.manager.v2.GP_OVERLAY_HIDE";
    private static final int REQUEST_OPEN_APP = 7353;

    private WindowManager windowManager;
    private TextView bubble;
    private WindowManager.LayoutParams layoutParams;
    private float downRawX;
    private float downRawY;
    private int startX;
    private int startY;
    private boolean moved;
    private int touchSlop;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_HIDE.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        showBubble();
        return START_NOT_STICKY;
    }

    private void showBubble() {
        if (bubble != null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            stopSelf();
            return;
        }

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (windowManager == null) {
            stopSelf();
            return;
        }

        bubble = new TextView(this);
        bubble.setText("✦");
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(25);
        bubble.setGravity(Gravity.CENTER);
        bubble.setContentDescription("Control flotante de JARVIS. Tocá para finalizar el escaneo.");
        bubble.setTooltipText("JARVIS · Finalizar escaneo");
        bubble.setElevation(dp(8));
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(Color.rgb(76, 72, 198));
        background.setStroke(dp(2), Color.rgb(150, 155, 255));
        bubble.setBackground(background);

        int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams = new WindowManager.LayoutParams(
            dp(58),
            dp(58),
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.END | Gravity.CENTER_VERTICAL;
        layoutParams.x = dp(14);
        layoutParams.y = 0;

        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
        bubble.setOnClickListener(view -> showFinishConfirmation());
        bubble.setOnTouchListener(this::handleBubbleTouch);
        try {
            windowManager.addView(bubble, layoutParams);
        } catch (Exception error) {
            bubble = null;
            stopSelf();
        }
    }

    private boolean handleBubbleTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                startX = layoutParams.x;
                startY = layoutParams.y;
                moved = false;
                return true;
            case MotionEvent.ACTION_MOVE:
                float deltaX = event.getRawX() - downRawX;
                float deltaY = event.getRawY() - downRawY;
                if (Math.abs(deltaX) > touchSlop || Math.abs(deltaY) > touchSlop) moved = true;
                if (moved) {
                    layoutParams.x = Math.max(0, startX - Math.round(deltaX));
                    layoutParams.y = startY + Math.round(deltaY);
                    try { windowManager.updateViewLayout(bubble, layoutParams); }
                    catch (Exception ignored) {}
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (!moved) view.performClick();
                return true;
            case MotionEvent.ACTION_CANCEL:
                return true;
            default:
                return true;
        }
    }

    private void showFinishConfirmation() {
        if (isFinishingOrNoScan()) {
            stopSelf();
            return;
        }
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("¿Finalizar el escaneo?")
            .setMessage("JARVIS detendrá la captura, analizará las pantallas leídas y volverá a JB Manager para mostrar los resultados.")
            .setNegativeButton("Seguir escaneando", (window, which) -> window.dismiss())
            .setPositiveButton("Finalizar y revisar", (window, which) -> {
                GoPartnersScanSession.requestFinishFromOverlay();
                returnToManager();
                stopSelf();
            })
            .create();
        if (dialog.getWindow() != null) {
            int dialogType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
            dialog.getWindow().setType(dialogType);
        }
        try { dialog.show(); }
        catch (Exception ignored) { dialog.dismiss(); }
    }

    private boolean isFinishingOrNoScan() {
        return !GoPartnersScanSession.isRunning() && !GoPartnersScanSession.isProcessing();
    }

    private void returnToManager() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) return;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            PendingIntent pending = PendingIntent.getActivity(
                this,
                REQUEST_OPEN_APP,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            if (Build.VERSION.SDK_INT >= 34) {
                ActivityOptions options = ActivityOptions.makeBasic();
                options.setPendingIntentBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                );
                pending.send(this, 0, null, null, null, null, options.toBundle());
            } else {
                pending.send();
            }
        } catch (Exception error) {
            try { startActivity(launch); } catch (Exception ignored) {}
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroy() {
        if (bubble != null && windowManager != null) {
            try { windowManager.removeView(bubble); } catch (Exception ignored) {}
        }
        bubble = null;
        windowManager = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
