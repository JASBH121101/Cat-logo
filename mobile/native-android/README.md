# JARVIS Go Partners screen scanner

The scanner is a native Capacitor plugin used by the JB Manager Android APK.

## Runtime flow

1. The administrator starts a scan from the authenticated JB Manager panel.
2. `GoPartnersScannerPlugin` requests Android's system MediaProjection consent.
3. `GoPartnersCaptureService` runs as a foreground media-projection service and publishes a persistent notification with a stop action.
4. Frames are held only in RAM, sampled approximately every 1.9 seconds, downscaled for OCR, and processed locally with bundled ML Kit Latin text recognition.
5. Temporary OCR observations are held in the static `GoPartnersScanSession` buffer (maximum 80 observations). No bitmap, screenshot, video, or OCR text is written to files or SharedPreferences.
6. The administrator stops the scan and chooses Finalizar y revisar. Only the bounded OCR text is then sent to the authenticated Cloudflare Function; images are never uploaded.
7. The browser-side scanner proposes matches and asks for duplicate confirmation. Provider prices are staged in the existing private provider-review dialog. The dialog is opened first so its selected product configuration rows exist before exact RAM/storage matching. No catalog write or public-price change occurs from the scanner itself.

## Privacy and platform constraints

- Android displays the system screen-capture permission for each new session.
- The foreground notification remains visible while capture is active and offers a stop action.
- The scanner must not attempt to bypass Android capture restrictions. If the provider app marks its window secure, Android may return a blank or blocked frame; stop and use the manual photo workflow instead.
- When Android offers app-only sharing, choose Go Partners to avoid exposing other apps. If only full-screen capture is offered, keep personal chats, customer details, payment screens, and other sensitive content off-screen during the scan.
- OCR observations exist only in process memory. Clearing the session or terminating the app process discards them.
- A session is capped at 80 observations. The UI reports when the cap is reached so the user can run another session.

## Build integration

The APK workflow copies these Java sources into the generated Capacitor Android package, registers `GoPartnersScannerPlugin` in `MainActivity`, installs the media-projection foreground service and permission declarations, and adds the bundled ML Kit text-recognition dependency. The workflow separately verifies that the installed app ID and persistent update signing certificate have not changed.
