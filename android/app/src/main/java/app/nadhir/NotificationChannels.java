package app.nadhir;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Canonical Android notification channels registered at native startup.
 * Mirrors {@code NOTIFICATION_CHANNELS} in {@code src/lib/notification-channels.ts} verbatim.
 */
public final class NotificationChannels {

    public static final String URGENT_ID = "alerts_urgent";
    public static final String OFFICIAL_ID = "alerts_official";
    public static final String EARTHQUAKES_ID = "alerts_earthquakes";
    public static final String CIVIL_ID = "alerts_civil";
    public static final String TEST_ID = "alerts_test";
    public static final String LEGACY_ID = "alerts";

    public static final class Spec {

        public final String id;
        public final int importance;
        public final boolean vibration;
        public final boolean lights;
        public final int visibility;
        public final int nameResId;
        public final int descriptionResId;
        public final boolean legacyFallback;

        public Spec(
            String id,
            int importance,
            boolean vibration,
            boolean lights,
            int visibility,
            int nameResId,
            int descriptionResId,
            boolean legacyFallback
        ) {
            this.id = id;
            this.importance = importance;
            this.vibration = vibration;
            this.lights = lights;
            this.visibility = visibility;
            this.nameResId = nameResId;
            this.descriptionResId = descriptionResId;
            this.legacyFallback = legacyFallback;
        }
    }

    public static final List<Spec> ALL = Collections.unmodifiableList(
        Arrays.asList(
            new Spec(
                URGENT_ID,
                NotificationManager.IMPORTANCE_HIGH,
                true,
                true,
                Notification.VISIBILITY_PUBLIC,
                R.string.notification_channel_urgent_name,
                R.string.notification_channel_urgent_description,
                false
            ),
            new Spec(
                OFFICIAL_ID,
                NotificationManager.IMPORTANCE_HIGH,
                true,
                true,
                Notification.VISIBILITY_PUBLIC,
                R.string.notification_channel_official_name,
                R.string.notification_channel_official_description,
                false
            ),
            new Spec(
                EARTHQUAKES_ID,
                NotificationManager.IMPORTANCE_HIGH,
                true,
                true,
                Notification.VISIBILITY_PUBLIC,
                R.string.notification_channel_earthquakes_name,
                R.string.notification_channel_earthquakes_description,
                false
            ),
            new Spec(
                CIVIL_ID,
                NotificationManager.IMPORTANCE_DEFAULT,
                false,
                false,
                Notification.VISIBILITY_PUBLIC,
                R.string.notification_channel_civil_name,
                R.string.notification_channel_civil_description,
                false
            ),
            new Spec(
                TEST_ID,
                NotificationManager.IMPORTANCE_DEFAULT,
                true,
                false,
                Notification.VISIBILITY_PUBLIC,
                R.string.notification_channel_test_name,
                R.string.notification_channel_test_description,
                false
            ),
            new Spec(
                LEGACY_ID,
                NotificationManager.IMPORTANCE_HIGH,
                true,
                true,
                Notification.VISIBILITY_PUBLIC,
                R.string.notification_channel_legacy_name,
                R.string.notification_channel_legacy_description,
                true
            )
        )
    );

    public static void ensureAll(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        AudioAttributes soundAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        List<NotificationChannel> channels = new ArrayList<>(ALL.size());
        for (Spec spec : ALL) {
            NotificationChannel channel = new NotificationChannel(
                spec.id,
                context.getString(spec.nameResId),
                spec.importance
            );
            channel.setDescription(context.getString(spec.descriptionResId));
            channel.enableVibration(spec.vibration);
            channel.enableLights(spec.lights);
            channel.setLockscreenVisibility(spec.visibility);
            channel.setShowBadge(true);
            channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, soundAttributes);
            channels.add(channel);
        }
        manager.createNotificationChannels(channels);
    }

    private NotificationChannels() {}
}
