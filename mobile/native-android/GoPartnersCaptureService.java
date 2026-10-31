package com.jbcollections.manager.v2;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;


import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.zip.CRC32;

public class GoPartnersCaptureService extends Service {
    private static final String ACTION_START = "com.jbcollections.manager.v2.GP_SCAN_START";
    private static final String ACTION_STOP = "com.jbcollections.manager.v2.GP_SCAN_STOP";
    private static final String EXTRA_RESULT_CODE = "projection_result_code";
    private static final String EXTRA_RESULT_DATA = "projection_result_data";
    private static final String CHANNEL_ID = "jb_go_partners_scan";
    private static final int NOTIFICATION_ID = 7352;
    private static final int MAX_TEXT_CHARS = 1500;
    private static final long MIN_FRAME_INTERVAL_MS = 1900L;

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private TextRecognizer recognizer;
    private volatile boolean processing = false;
    private volatile boolean stopping = false;
    private boolean shutdownFinished = false;
    private long lastFrameAt = 0L;
    private long lastFrameHash = -1L;
    private String lastRecognizedText = "";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            requestStop();
            return START_NOT_STICKY;
        }
        if (intent == null || !ACTION_START.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (projection != null) return START_NOT_STICKY;

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = readIntentExtra(intent, EXTRA_RESULT_DATA);
        if (resultCode == 0 || resultData == null) {
            GoPartnersScanSession.setFlags(false, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startForegroundCompat();
            startProjection(resultCode, resultData);
        } catch (Exception error) {
            android.util.Log.e("JBGoPartnersScanner", "Could not start screen capture service", error);
            requestStop();
        }
        return START_NOT_STICKY;
    }

    private Intent readIntentExtra(Intent source, String key) {
        if (Build.VERSION.SDK_INT >= 33) return source.getParcelableExtra(key, Intent.class);
        //noinspection deprecation
        return source.getParcelableExtra(key);
    }

    private void startForegroundCompat() {
        createNotificationChannel();
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        GoPartnersScanSession.setFlags(true, false);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Escaneo de Go Partners", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Indica cuándo JARVIS está leyendo texto de la pantalla.");
        channel.setShowBadge(false);
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openApp = launch == null ? null : PendingIntent.getActivity(
            this, 1, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, GoPartnersCaptureService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(
            this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_menu_search)
            .setContentTitle("JARVIS está escaneando")
            .setContentText("Navegá por Go Partners. Usá el control flotante de JARVIS para revisar.")
            .setOngoing(true)
            .setOnlyAlertOnce(true);
        if (openApp != null) builder.setContentIntent(openApp);
        builder.addAction(android.R.drawable.ic_media_pause, "Detener", stopAction);
        return builder.build();
    }

    private void startProjection(int resultCode, Intent resultData) {
        MediaProjectionManager manager = (MediaProjectionManager)
            getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) throw new IllegalStateException("MediaProjection no está disponible.");
        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) throw new IllegalStateException("Android no entregó la sesión de captura.");

        captureThread = new HandlerThread("JBGoPartnersScreenOCR");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

        Display display = ((WindowManager) getSystemService(WINDOW_SERVICE)).getDefaultDisplay();
        DisplayMetrics metrics = new DisplayMetrics();
        display.getRealMetrics(metrics);
        int width = metrics.widthPixels;
        int height = metrics.heightPixels;
        if (width <= 0 || height <= 0) throw new IllegalStateException("No se pudo determinar el tamaño de pantalla.");

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(this::processLatestFrame, captureHandler);
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() {
                if (!stopping) {
                    GoPartnersScanSession.markInterrupted(
                        "Android detuvo o revocó el permiso de captura.");
                }
                requestStop();
            }
        }, captureHandler);

        virtualDisplay = projection.createVirtualDisplay(
            "JBGoPartnersScanner", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, imageReader.getSurface(), null, captureHandler);
        if (virtualDisplay == null) throw new IllegalStateException("No se pudo iniciar la captura de pantalla.");
        GoPartnersScanSession.setFlags(true, false);
    }

    private void processLatestFrame(ImageReader reader) {
        if (stopping || processing || reader == null) return;
        long now = System.currentTimeMillis();
        if (now - lastFrameAt < MIN_FRAME_INTERVAL_MS) {
            Image skipped = reader.acquireLatestImage();
            if (skipped != null) skipped.close();
            return;
        }

        Image image = reader.acquireLatestImage();
        if (image == null) return;
        Bitmap bitmap = null;
        try {
            bitmap = imageToBitmap(image);
        } catch (Exception error) {
            android.util.Log.w("JBGoPartnersScanner", "Could not convert screen frame", error);
        } finally {
            image.close();
        }
        if (bitmap == null) return;

        long hash = bitmapHash(bitmap);
        if (hash == lastFrameHash) {
            bitmap.recycle();
            return;
        }
        lastFrameHash = hash;
        lastFrameAt = now;
        processing = true;
        GoPartnersScanSession.setFlags(true, true);
        final Bitmap frame = bitmap;
        try {
            recognizer.process(InputImage.fromBitmap(frame, 0))
                .addOnSuccessListener(result -> appendObservation(result, now))
                .addOnFailureListener(error -> android.util.Log.w(
                    "JBGoPartnersScanner", "OCR frame failed; it is ignored rather than treated as a missing product.", error))
                .addOnCompleteListener(task -> {
                    processing = false;
                    if (!frame.isRecycled()) frame.recycle();
                    GoPartnersScanSession.setFlags(!stopping, false);
                    if (stopping) finishShutdown();
                });
        } catch (Exception error) {
            processing = false;
            if (!frame.isRecycled()) frame.recycle();
            GoPartnersScanSession.setFlags(!stopping, false);
            if (stopping) finishShutdown();
        }
    }

    private Bitmap imageToBitmap(Image image) {
        Image.Plane[] planes = image.getPlanes();
        if (planes == null || planes.length == 0) return null;
        Image.Plane plane = planes[0];
        ByteBuffer buffer = plane.getBuffer();
        int width = image.getWidth();
        int height = image.getHeight();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = rowStride - pixelStride * width;
        int paddedWidth = width + Math.max(0, rowPadding / Math.max(1, pixelStride));
        Bitmap padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888);
        buffer.rewind();
        padded.copyPixelsFromBuffer(buffer);
        Bitmap cropped;
        if (paddedWidth == width) {
            cropped = padded;
        } else {
            cropped = Bitmap.createBitmap(padded, 0, 0, width, height);
            padded.recycle();
        }

        int maxWidth = 1280;
        if (cropped.getWidth() > maxWidth) {
            int targetHeight = Math.max(1, Math.round(cropped.getHeight() * (maxWidth / (float) cropped.getWidth())));
            Bitmap scaled = Bitmap.createScaledBitmap(cropped, maxWidth, targetHeight, true);
            cropped.recycle();
            return scaled;
        }
        return cropped;
    }

    private long bitmapHash(Bitmap bitmap) {
        CRC32 crc = new CRC32();
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        for (int y = 0; y < height; y += Math.max(1, height / 18)) {
            for (int x = 0; x < width; x += Math.max(1, width / 18)) {
                int color = bitmap.getPixel(x, y);
                crc.update((color >> 16) & 0xff);
                crc.update((color >> 8) & 0xff);
                crc.update(color & 0xff);
            }
        }
        return crc.getValue();
    }

    private synchronized void appendObservation(Text recognized, long capturedAt) {
        if (recognized == null) return;
        String text = recognized.getText();
        if (text == null) return;
        text = text.replaceAll("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]", " ")
            .replaceAll("[ \\t]+", " ").replaceAll("\\n{2,}", "\\n").trim();
        if (text.length() < 8) return;
        if (text.length() > MAX_TEXT_CHARS) text = text.substring(0, MAX_TEXT_CHARS);
        String normalized = text.toLowerCase(Locale.ROOT);
        if (normalized.equals(lastRecognizedText)) return;
        lastRecognizedText = normalized;
        GoPartnersScanSession.appendObservation(text, capturedAt);
    }

    private void requestStop() {
        if (stopping) return;
        stopping = true;
        GoPartnersScanSession.setFlags(false, processing);
        try { if (imageReader != null) imageReader.setOnImageAvailableListener(null, null); } catch (Exception ignored) {}
        try { if (virtualDisplay != null) virtualDisplay.release(); } catch (Exception ignored) {}
        virtualDisplay = null;
        try { if (imageReader != null) imageReader.close(); } catch (Exception ignored) {}
        imageReader = null;
        MediaProjection currentProjection = projection;
        projection = null;
        try { if (currentProjection != null) currentProjection.stop(); } catch (Exception ignored) {}
        if (!processing) finishShutdown();
    }

    private synchronized void finishShutdown() {
        if (shutdownFinished) return;
        shutdownFinished = true;
        try { if (recognizer != null) recognizer.close(); } catch (Exception ignored) {}
        recognizer = null;
        if (captureThread != null) {
            try { captureThread.quitSafely(); } catch (Exception ignored) {}
            captureThread = null;
        }
        captureHandler = null;
        GoPartnersScanSession.setFlags(false, false);
        try { stopService(new Intent(this, GoPartnersOverlayService.class)); } catch (Exception ignored) {}
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        try { stopForeground(true); } catch (Exception ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (!stopping) {
            GoPartnersScanSession.markInterrupted(
                "Android cerró el servicio de captura inesperadamente.");
            requestStop();
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
