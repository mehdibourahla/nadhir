package app.nadhir;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Notification;
import android.app.NotificationManager;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

public class NotificationChannelsTest {

    @Test
    public void definesSixCanonicalChannelsInExactOrder() {
        assertEquals(6, NotificationChannels.ALL.size());
        List<String> expectedIds = Arrays.asList(
            NotificationChannels.URGENT_ID,
            NotificationChannels.OFFICIAL_ID,
            NotificationChannels.EARTHQUAKES_ID,
            NotificationChannels.CIVIL_ID,
            NotificationChannels.TEST_ID,
            NotificationChannels.LEGACY_ID
        );
        assertEquals(
            Arrays.asList(
                "alerts_urgent",
                "alerts_official",
                "alerts_earthquakes",
                "alerts_civil",
                "alerts_test",
                "alerts"
            ),
            expectedIds
        );
        for (int i = 0; i < expectedIds.size(); i++) {
            assertEquals(expectedIds.get(i), NotificationChannels.ALL.get(i).id);
        }
    }

    @Test
    public void matchesCanonicalImportanceVibrationLightsVisibilityAndLegacyFlags() {
        NotificationChannels.Spec urgent = NotificationChannels.ALL.get(0);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, urgent.importance);
        assertTrue(urgent.vibration);
        assertTrue(urgent.lights);
        assertEquals(Notification.VISIBILITY_PUBLIC, urgent.visibility);
        assertFalse(urgent.legacyFallback);

        NotificationChannels.Spec official = NotificationChannels.ALL.get(1);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, official.importance);
        assertTrue(official.vibration);
        assertTrue(official.lights);
        assertEquals(Notification.VISIBILITY_PUBLIC, official.visibility);
        assertFalse(official.legacyFallback);

        NotificationChannels.Spec earthquakes = NotificationChannels.ALL.get(2);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, earthquakes.importance);
        assertTrue(earthquakes.vibration);
        assertTrue(earthquakes.lights);
        assertEquals(Notification.VISIBILITY_PUBLIC, earthquakes.visibility);
        assertFalse(earthquakes.legacyFallback);

        NotificationChannels.Spec civil = NotificationChannels.ALL.get(3);
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, civil.importance);
        assertFalse(civil.vibration);
        assertFalse(civil.lights);
        assertEquals(Notification.VISIBILITY_PUBLIC, civil.visibility);
        assertFalse(civil.legacyFallback);

        NotificationChannels.Spec test = NotificationChannels.ALL.get(4);
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, test.importance);
        assertTrue(test.vibration);
        assertFalse(test.lights);
        assertEquals(Notification.VISIBILITY_PUBLIC, test.visibility);
        assertFalse(test.legacyFallback);

        NotificationChannels.Spec legacy = NotificationChannels.ALL.get(5);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, legacy.importance);
        assertTrue(legacy.vibration);
        assertTrue(legacy.lights);
        assertEquals(Notification.VISIBILITY_PUBLIC, legacy.visibility);
        assertTrue(legacy.legacyFallback);
    }

    @Test
    public void assignsUniqueStringResourceIdsToEveryChannel() {
        Set<Integer> nameResIds = new HashSet<>();
        Set<Integer> descriptionResIds = new HashSet<>();
        Set<Integer> allResIds = new HashSet<>();
        for (NotificationChannels.Spec spec : NotificationChannels.ALL) {
            assertTrue("duplicate nameResId for " + spec.id, nameResIds.add(spec.nameResId));
            assertTrue("duplicate descriptionResId for " + spec.id, descriptionResIds.add(spec.descriptionResId));
            assertTrue("name/description collision for " + spec.id, allResIds.add(spec.nameResId));
            assertTrue("description/name collision for " + spec.id, allResIds.add(spec.descriptionResId));
        }
        assertEquals(6, nameResIds.size());
        assertEquals(6, descriptionResIds.size());
        assertEquals(12, allResIds.size());
    }

    @Test
    public void ensureAllIgnoresNullContext() {
        NotificationChannels.ensureAll(null);
    }
}
