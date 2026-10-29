# JB Manager Collections — Android

This folder wraps the existing private admin panel in a Capacitor Android application.

## How the build works

1. GitHub Actions copies the repository's live web assets into a temporary bundle.
2. The bundle starts at the existing `admin.html` panel, not the public catalog landing page.
3. The application uses the existing Supabase configuration and current JB Collections icon artwork.
4. GitHub Actions builds a versioned debug APK from the latest `main` web assets and publishes an artifact for 14 days plus a GitHub prerelease.

## Generate the APK

Open the repository's **Actions** tab and select **Build JB Manager Collections APK**. On the branch `feature/jb-manager-android-apk`, the workflow also runs automatically after a push.

When the run has completed successfully, open the run and download the artifact named **JB-Manager-Collections-APK**. Extract the ZIP to get `app-debug.apk`, then install it on Android. Android may ask to allow installs from the browser or file manager used to open the APK.

## Updating the app already installed

- Every successful build packages the latest web assets from `main` inside a higher APK version. The installed app cannot receive those bundled HTML/CSS/JS changes from a website deployment alone.
- Updates are intended to replace the existing app in place: keep `appId` as `com.jbcollections.manager.v2` and keep the persistent Android signing key unchanged. Android still asks the user to confirm installation.
- The in-app updater checks GitHub Releases, validates the requested version, downloaded APK, package identity, and signing certificate before it opens the Android installer. Do not publish an APK with a regenerated signing key; Android will reject it as an update.

## Notes

- This is an installable debug build for personal testing, not a Play Store release.
- Catalog edits still require internet access because product data, authentication, and image storage use Supabase.
- The application bundle contains the admin web assets but does not contain Supabase service-role credentials. The existing public publishable/anonymous key continues to rely on Supabase Row Level Security and database policies.
- The public GitHub Pages URLs are not changed by this Android wrapper.

- Android APK notifications use Capacitor Local Notifications for permission prompts and on-device alerts while JB Manager is running and polling the inbox. This is not background push: alerts while the app is backgrounded or closed require a separately configured Firebase Cloud Messaging (FCM) project and server credentials. The browser version continues to use Web Push and its service worker.
