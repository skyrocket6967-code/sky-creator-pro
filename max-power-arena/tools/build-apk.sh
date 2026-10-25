#!/usr/bin/env bash
# Builds release/Max-Power-Arena.apk with the plain Android command-line tools:
#   aapt (manifest, resources, game assets), javac, dx/dalvik-exchange, zipalign and apksigner.
# Ubuntu: apt-get install aapt zipalign apksigner dalvik-exchange android-sdk-platform-23
set -euo pipefail
cd "$(dirname "$0")/.."

# Compile against a recent SDK; link resources against API 23 (the newest resource table aapt can read).
ANDROID_JAR=${ANDROID_JAR:-/opt/android-jars/android-35.jar}
RES_JAR=${RES_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
DX=${DX:-$(command -v dalvik-exchange || command -v dx)}
# Same key as the Aurelia Strike builds, so Max Power Arena installs as an update over them.
KEYSTORE=${KEYSTORE:-keystore/aurelia-debug.keystore}
OUT=build/apk

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias aurelia \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Aurelia Strike Debug"
fi

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" release

echo "> aapt"
aapt package -f -m -J "$OUT/gen" -M android/AndroidManifest.xml -S android/res -A android/assets \
  -I "$RES_JAR" -F "$OUT/unsigned.apk"

echo "> javac"
javac -source 8 -target 8 -Xlint:-options -encoding UTF-8 -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" $(find android/java "$OUT/gen" -name '*.java')

echo "> dex"
"$DX" --dex --min-sdk-version=23 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && zip -q -j unsigned.apk classes.dex)

echo "> zipalign + sign"
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android --ks-key-alias aurelia \
  --out release/Max-Power-Arena.apk "$OUT/aligned.apk"
apksigner verify release/Max-Power-Arena.apk
rm -f release/Max-Power-Arena.apk.idsig
ls -la release/Max-Power-Arena.apk
