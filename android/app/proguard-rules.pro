# Nadhir R8 / ProGuard keep rules (AGP 8.13 full mode)

# Preserve runtime annotations, generics, inner class metadata, and stack trace line numbers
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# WebView @JavascriptInterface bridges (Capacitor MessageHandler, CapacitorHttp, CapacitorCookies)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor runtime annotation interfaces (required under AGP 8+ R8 full mode; ionic-team/capacitor#8589)
-keep @interface com.getcapacitor.** { *; }

# Capacitor base Plugin class (inherited @PluginMethod and @PermissionCallback methods: addListener, removeListener, removeAllListeners, checkPermissions, requestPermissions)
-keep class com.getcapacitor.Plugin { *; }

# Capacitor plugins discovered reflectively via capacitor.plugins.json and annotation scanning
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }

# Capacitor core bridge, WebView clients, data containers, and built-in plugins
-keep class com.getcapacitor.Bridge { *; }
-keep class com.getcapacitor.BridgeActivity { *; }
-keep class com.getcapacitor.BridgeWebViewClient { *; }
-keep class com.getcapacitor.BridgeWebChromeClient { *; }
-keep class com.getcapacitor.CapacitorWebView { *; }
-keep class com.getcapacitor.MessageHandler { *; }
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.JSArray { *; }
-keep class com.getcapacitor.PluginCall { *; }
-keep class com.getcapacitor.PluginResult { *; }
-keep class com.getcapacitor.PermissionState { *; }
-keep class com.getcapacitor.plugin.** { *; }

# Nadhir entrypoints, startup notification channels, auth plugin, and on-device Current Commune resolver
-keep class app.nadhir.MainActivity { *; }
-keep class app.nadhir.NotificationChannels { *; }
-keep class app.nadhir.NotificationChannels$* { *; }
-keep class app.nadhir.auth.NativeAuthPlugin { *; }
-keep class app.nadhir.commune.** { *; }

# Capacitor official plugins, Firebase Messaging plugin, and Ionic native libraries (no consumerProguardFiles in plugins)
-keep class io.capawesome.capacitorjs.plugins.firebase.messaging.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class io.ionic.libs.** { *; }
