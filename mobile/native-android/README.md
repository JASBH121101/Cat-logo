# JARVIS Go Partners screen scanner

The scanner is a native Capacitor plugin used by the JB Manager Android APK.

## Runtime flow

1. The administrator starts a scan from the authenticated JB Copilot conversation.
2. If needed, `GoPartnersScannerPlugin` asks Android once for the special "Display over other apps" permission. The app then requests Android's system MediaProjection consent for each scan session.
3. `GoPartnersCaptureService` runs as a foreground media-projection service and publishes a persistent notification. `GoPartnersOverlayService` shows a small draggable JARVIS control above Go Partners.
4. Tapping the floating control opens an Android confirmation. Choosing "Finalizar y revisar" marks the handoff, returns the existing JB Manager task to the foreground, and lets the WebView stop capture and run the same review flow automatically.
5. Frames are held only in RAM, sampled approximately every 1.9 seconds, downscaled for OCR, and processed locally with bundled ML Kit Latin text recognition.
6. Temporary OCR observations are held in the static `GoPartnersScanSession` buffer (maximum 80 observations). No bitmap, screenshot, video, or OCR text is written to files or SharedPreferences.
7. Only the bounded OCR text is sent to the authenticated Cloudflare Function; images are never uploaded. The results and duplicate confirmation appear inside the Copilot conversation.
8. The browser-side scanner proposes matches and stages supplier prices in the existing private provider-review dialog. No catalog write or public-price change occurs from the scanner itself.

## Privacy and platform constraints

- Android displays the system screen-capture permission for each new session.
- The foreground notification remains visible while capture is active and offers a stop action.
- The floating control requires Android's `SYSTEM_ALERT_WINDOW` special permission. It is shown only during an active scan, can be dragged out of the way, and contains only a JARVIS finish action; it does not read or alter provider app content.
- The finish action requires explicit confirmation. On confirmation it sets an in-memory handoff flag and returns the existing JB Manager task to the foreground. The browser-side scanner then calls the same authenticated OCR review endpoint used by the in-app fallback.
- If overlay permission is denied or the overlay service cannot start, the capture is stopped safely rather than leaving an unattended session.
- An unexpected MediaProjection stop or service destruction marks the session as interrupted and preserves OCR observations already collected. An intentional stop initiated from the scanner does not mark the session as interrupted.
- If capture is interrupted, the UI warns that results may be incomplete and allows the user to review the partial OCR or discard it.
- The scanner must not attempt to bypass Android capture restrictions. If the provider app marks its window secure, Android may return a blank or blocked frame; stop and use the manual photo workflow instead.
- When Android offers app-only sharing, choose Go Partners to avoid exposing other apps. If only full-screen capture is offered, keep personal chats, customer details, payment screens, and other sensitive content off-screen during the scan.
- OCR observations exist only in process memory. Clearing the session or terminating the app process discards them.
- A session is capped at 80 observations. The UI reports when the cap is reached so the user can run another session.

## JB Copilot voice input

- The `JbVoiceInput` Capacitor plugin checks `RECORD_AUDIO` and requests the Android runtime permission only when the administrator taps the microphone. The permission request is dispatched on Android's UI thread through Capacitor's registered permission callback.
- A denied request can be retried from the microphone button. Repeated denial is tracked only after Android returns the permission result; when the permission is permanently blocked, or the native permission request does not return, JB Manager exposes an `Abrir permisos del micrófono` action that opens the app's Android settings page.
- Speech recognition uses Android's configured `SpeechRecognizer` service with partial and final transcript callbacks. It is push-to-talk; the app does not run continuous background listening.
- Android's default speech-recognition implementation may process audio remotely. JB Manager does not persist or upload raw microphone audio itself; it receives the recognized text locally in the WebView, and the text is sent to JB Copilot only after the administrator presses Enviar.
- If the system speech service is unavailable, denied, offline, or does not support the requested Spanish locale, the interface reports the specific failure and retains the text-entry fallback.
- The native plugin destroys its `SpeechRecognizer` instance when the Capacitor bridge is destroyed and cancels active listening on administrator logout.

## Build integration

The APK workflow copies these Java sources into the generated Capacitor Android package, registers `GoPartnersScannerPlugin` and `JbVoiceInputPlugin` in `MainActivity`, installs the media-projection foreground service, microphone permission and Android 11+ speech-service visibility query, and adds the bundled ML Kit text-recognition dependency. The workflow separately verifies that the installed app ID and persistent update signing certificate have not changed.


## APK updates in the background

- APK downloads are enqueued with Android's system `DownloadManager`; they are not streamed by the WebView or by a JavaScript timer. Android owns the transfer, so minimizing JB Manager or closing its screen from the recent-apps list does not cancel an accepted download.
- Android displays the system download notification while the transfer is running and after it completes. Metered/mobile data is allowed; roaming is disabled.
- The download ID, target version and app-scoped destination filename are persisted in native preferences. When JB Manager is opened again, the panel queries Android's DownloadManager and restores the current progress, pause/failure state or completed APK.
- The APK is checked for package ID, version, full byte count and signing-certificate match before the installer can be opened. Android still requires the administrator to confirm installation; JB Manager does not silently replace itself.
- This guarantee applies to leaving/minimizing the app or removing its task from Recents. Android system restrictions, loss of network, insufficient storage or explicitly force-stopping/disabling system download components can still interrupt a transfer.

- The floating JARVIS control is started with the MediaProjection session and must remain visible while Go Partners is being captured. Creating the foreground notification channel must not stop the overlay; the capture service removes the overlay only during its shutdown path.


- The current JB Copilot build exposes a local OCR transcript for every captured observation, recovers a candidate against its verified source observation when the model returns an incorrect observation index, and allows only bounded product-identity OCR corrections. Supplier prices still require exact numeric and currency evidence in the same OCR context. The web/API assets are assembled from the latest `main` during the APK workflow.
