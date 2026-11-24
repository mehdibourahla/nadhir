# Nadhir R8 / ProGuard keep rules (AGP 8.13 full mode)

# Preserve runtime annotations, generics, inner class metadata, and stack trace line numbers
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# WebView @JavascriptInterface bridges (Capacitor MessageHandler, CapacitorHttp, CapacitorCookies)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor plugins discovered reflectively via capacitor.plugins.json and annotation scanning
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.BridgeActivity { *; }
-keep class com.getcapacitor.MessageHandler { *; }
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.JSArray { *; }
-keep class com.getcapacitor.PluginCall { *; }

# Nadhir entrypoints, startup notification channels, auth plugin, and on-device Current Commune resolver
-keep class app.nadhir.MainActivity { *; }
-keep class app.nadhir.NotificationChannels { *; }
-keep class app.nadhir.NotificationChannels$* { *; }
-keep class app.nadhir.auth.NativeAuthPlugin { *; }
-keep class app.nadhir.commune.** { *; }

# Capacitor official plugins and Firebase Messaging plugin (ships no consumerProguardFiles)
-keep class io.capawesome.capacitorjs.plugins.firebase.messaging.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
