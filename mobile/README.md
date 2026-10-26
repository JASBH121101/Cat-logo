# JB Manager Collections — Android

This folder wraps the existing private admin panel in a Capacitor Android application.

## How the build works

1. GitHub Actions copies the repository's live web assets into a temporary bundle.
2. The bundle starts at the existing `admin.html` panel, not the public catalog landing page.
3. The application uses the existing Supabase configuration and current JB Collections icon artwork.
4. GitHub Actions builds a debug APK and publishes it as the `JB-Manager-Collections-APK` artifact for 14 days.

## Generate the APK

Open the repository's **Actions** tab and select **Build JB Manager Collections APK**. On the branch `feature/jb-manager-android-apk`, the workflow also runs automatically after a push.

When the run has completed successfully, open the run and download the artifact named **JB-Manager-Collections-APK**. Extract the ZIP to get `app-debug.apk), then install it on Android. Android may ask to allow installs from the browser or file manager used to open the APK.

## Notes

- This is an installable debug build for personal testing, not a Play Store release.
- Catalog edits still require internet access because product data, authentication, and image storage use Supabase.
- The application bundle contains the admin web assets but does not contain Supabase service-role credentials. The existing public publishable/anonymous key continues to rely on Supabase Row Level Security and database policies.
- The public GitHub Pages URLs are not changed by this Android wrapper.
