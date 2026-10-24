#!/usr/bin/env bash
# Builds release/PowerSimulator.apk without Gradle, using the command-line Android tools:
#   aapt (resources), javac, dx/dalvik-exchange (dex), zipalign and apksigner.
# On Ubuntu: apt-get install aapt zipalign apksigner dalvik-exchange android-sdk-platform-23
# Android Studio users can ignore this and open the folder as a normal Gradle project.
set -euo pipefail
cd "$(dirname "$0")"

PKG=com.skyrocket.powersim
VERSION_CODE=1
VERSION_NAME=1.0
MIN_SDK=24
TARGET_SDK=35
# Compile against a recent SDK; link resources against API 23 (the newest resource table aapt can read).
ANDROID_JAR=${ANDROID_JAR:-/opt/android-jars/android-35.jar}
RES_JAR=${RES_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
DX=${DX:-$(command -v dalvik-exchange || command -v dx)}
OUT=build/apk

if [ ! -f keystore/debug.keystore ]; then
  mkdir -p keystore
  keytool -genkeypair -keystore keystore/debug.keystore -storepass android -keypass android \
    -alias powersim -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Power Simulator Debug"
fi

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" release

# Gradle injects the package and SDK levels from app/build.gradle; do the same here.
sed -e "s|<manifest |<manifest package=\"$PKG\" android:versionCode=\"$VERSION_CODE\" android:versionName=\"$VERSION_NAME\" |" \
    -e "s|    <application|    <uses-sdk android:minSdkVersion=\"$MIN_SDK\" android:targetSdkVersion=\"$TARGET_SDK\" />\n\n    <application|" \
    app/src/main/AndroidManifest.xml > "$OUT/AndroidManifest.xml"

echo "> aapt"
aapt package -f -m -J "$OUT/gen" -M "$OUT/AndroidManifest.xml" -S app/src/main/res \
  -I "$RES_JAR" -F "$OUT/unsigned.apk"

echo "> javac"
javac -source 8 -target 8 -Xlint:-options -encoding UTF-8 -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" $(find app/src/main/java "$OUT/gen" -name '*.java')

echo "> dex"
"$DX" --dex --min-sdk-version=$MIN_SDK --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && zip -q -j unsigned.apk classes.dex)

echo "> zipalign + sign"
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --ks keystore/debug.keystore --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias powersim --out release/PowerSimulator.apk "$OUT/aligned.apk"
apksigner verify release/PowerSimulator.apk
rm -f release/PowerSimulator.apk.idsig
ls -la release/PowerSimulator.apk
