package app.nadhir;

import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Bundle;
import android.webkit.WebView;
import app.nadhir.auth.NativeAuthPlugin;
import app.nadhir.commune.CurrentCommunePlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private ConnectivityManager connectivity;

    // WebView never learns connectivity on its own, so navigator.onLine would stay true offline
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override
        public void onAvailable(Network network) {
            setWebViewOnline(true);
        }

        @Override
        public void onLost(Network network) {
            setWebViewOnline(false);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        NotificationChannels.ensureAll(this);
        registerPlugin(CurrentCommunePlugin.class);
        registerPlugin(NativeAuthPlugin.class);
        super.onCreate(savedInstanceState);
        connectivity = getSystemService(ConnectivityManager.class);
        if (connectivity != null) {
            setWebViewOnline(connectivity.getActiveNetwork() != null);
            connectivity.registerDefaultNetworkCallback(networkCallback);
        }
    }

    @Override
    public void onDestroy() {
        if (connectivity != null) {
            connectivity.unregisterNetworkCallback(networkCallback);
        }
        super.onDestroy();
    }

    private void setWebViewOnline(boolean online) {
        runOnUiThread(() -> {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView != null) webView.setNetworkAvailable(online);
        });
    }
}
