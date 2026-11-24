package app.nadhir.commune;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import app.nadhir.NotificationChannels;

public class CommuneBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        NotificationChannels.ensureAll(context);
        // location requests do not survive a reboot or an app update
        if (!CommuneTracker.enabled(context)) return;
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) return;
        CommuneTracker.requestUpdates(context);
    }
}
