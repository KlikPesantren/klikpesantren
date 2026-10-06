# POS KlikPesantren — local review (no EAS)

Run from the canonical repository, then `cd pos-app`. Use `npm ci` when dependencies need restoring. Review is local synthetic UI data, not financial testing against production. It auto-enters a synthetic cashier session; no real login is needed.

## Web and fixture mode

```powershell
npm run review:web
```

Open http://localhost:8083. This script sets `POS_ENV=development`, `POS_REVIEW=1`, and a localhost API URL for this child process only. The adapter has no network calls, blocks authentication/checkout/refund/shift writes, and uses memory storage instead of real native credentials. Use the review strip to select normal/loading/empty/error/offline, shift open/closed, cart empty/populated, payment success, QRIS pending, RFID preview, insufficient balance, unknown/checking, and large amounts. Modal states have **Reset review** so unknown/checking never traps the reviewer. Fixture payments, balances and refunds are display-only, not a ledger.

Inspect Beranda, Kasir, Transaksi, Produk, Lainnya, cart, payment, receipt and shift-close UI. Set browser responsive widths to 360, 390 and 412 px. Check long names, prices, bottom tabs, modal scrolling and numeric keyboard separately on a phone. Web is not proof of native Android acceptance or a physical RFID reader.

Disable fixture mode by stopping Metro and starting a fresh process:

```powershell
$env:POS_ENV='development'
$env:POS_REVIEW='0'
$env:EXPO_PUBLIC_POS_API_URL='http://127.0.0.1:3000'
npm run web -- --port 8083 --clear
```

Real mode requires a separately authorized local backend/account; never point review fixtures at production. Config rejects review opt-in outside development; the app also requires `__DEV__`. Production export verification:

```powershell
$env:POS_ENV='production'
$env:POS_REVIEW='0'
npm run export:web -- --output-dir dist-production
npm run export:android -- --output-dir dist-android-production
node scripts/check-review-export.cjs dist-production dist-android-production
```

## Windows Android toolchain

Existing machine paths (process-only variables; no system settings changed):

```powershell
$env:JAVA_HOME='C:\Users\hi\AppData\Local\Programs\KlikPesantrenBuild\jdk17\jdk-17.0.20.1+1'
$env:ANDROID_HOME='C:\Users\hi\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
java -version
adb devices
```

Connect an Android phone by USB, enable USB debugging and approve the computer's RSA prompt. `adb devices` must show `device`, not `unauthorized`. No connected device/emulator was available during preparation.

## Build/install a local native debug app

Prefer the dedicated debug app for Android acceptance. Expo Go can support this app's basic SecureStore/Crypto UI loop but does not prove standalone package behavior, durable payment recovery or a physical RFID adapter.

```powershell
$env:POS_ENV='development'
$env:POS_REVIEW='1'
npx expo prebuild --platform android --no-install
Push-Location android
.\gradlew.bat :app:assembleDebug '-PreactNativeArchitectures=arm64-v8a' '-Pandroid.builder.sdkDownload=false' --console=plain
Pop-Location
```

This arm64 build is for a compatible physical phone. Native project, build artifacts and debug signing files remain ignored. Missing toolchain packages should be reviewed before installing; automatic SDK downloads are disabled in the command above.

After a successful Gradle build, use its actual `android/app/build/outputs/apk/debug/app-debug.apk` output, not an assumed artifact. Install and serve JS:

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
$env:POS_ENV='development'
$env:POS_REVIEW='1'
npx expo start --localhost --port 8081
adb shell am start -n com.klikpesantren.pos/.MainActivity
```

Alternatively, with the connected phone and toolchain variables above:

```powershell
$env:POS_ENV='development'
$env:POS_REVIEW='1'
npm run android -- --device --port 8083
```

The package script is the actual `expo run:android` native compile/install workflow. Review-only JS changes use Metro Fast Refresh; reload from the dev menu or press `r` in Metro. Restart Metro after config/environment changes; native dependency changes require prebuild/build again. `npm run review:android` starts localhost Metro in Expo Go mode only; after `adb reverse`, open `exp://127.0.0.1:8083` in an installed compatible Expo Go if using that optional UI-only path.

## Cheap repeat cycle and safety

Edit → `npm run review:web` → review widths/states → USB debug app → fix → run tests → repeat. No EAS, AAB, production deploy, DB migration, production checkout, Wallet debit or refund is part of this loop. Debug builds need Metro and use debug signing; they are not a final release artifact. Final release/EAS remains a separately authorized task.

From repository root run `npm run test:pos-mobile`, `npm run test:pos-v1`, `npm run test:pos-admin`, `npm --prefix pos-app run lint`, and `git diff --check`. Database suites require the dedicated isolated localhost PostgreSQL fixture, never production credentials.

## Verification boundary

Local debug build was actually attempted with installed JDK 17, SDK/build-tools 36 and NDK 27.1.12297006. Resolved minSdk=24, compile/targetSdk=36. It failed at `:app:buildCMakeDebug[arm64-v8a]`: Ninja reported **Filename longer than 260 characters** in generated react-native-safe-area-context C++ object paths under the long canonical checkout. No APK was produced. No SDK installation, system-wide path policy change, dependency downgrade or production action was performed. Minimum native-build prerequisite: use a verified short writable local build checkout (for example `C:\kp-pos`) preserving this commit, then regenerate native build files there and repeat the documented command. Do not discard or overwrite the canonical repository. Merely changing the terminal working directory through a link may retain original absolute CMake paths and is not a verified fix.

Manual Gradle debug APK uses Metro's native default port 8081; the web/Expo Go review helper uses 8083. The `expo run:android --port 8083` alternative configures its own native development server port.

Local web HTTP 200, web/Android exports, production fixture exclusion, fixture unit tests, POS domain/DB regressions and lint were verified. Browser automation could not initialize (computer-use helper failure), so the five screens and 360/390/412 layouts are **ready for manual review, not visual PASS**. No Android phone/emulator was present; Android runtime, keypad/reader behavior and native persistence acceptance remain unexecuted.
