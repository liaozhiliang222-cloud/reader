package dev.jingye.ttsprobe;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

final class ProbeVoices {
    static boolean usable(Voice voice) {
        return voice != null && !voice.isNetworkConnectionRequired()
            && voice.getFeatures() != null
            && !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
    }
    static List<Voice> offline(TextToSpeech tts) {
        List<Voice> result = new ArrayList<>();
        if (tts.getVoices() != null) for (Voice voice : tts.getVoices()) if (usable(voice)) result.add(voice);
        result.sort(Comparator.comparing(v -> v.getLocale().toLanguageTag() + v.getName()));
        return result;
    }
    static JSONObject inventory(Context context, TextToSpeech tts, String engine) throws Exception {
        JSONObject report = new JSONObject();
        report.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        report.put("android", Build.VERSION.RELEASE);
        report.put("sdk", Build.VERSION.SDK_INT);
        report.put("engine", engine);
        PackageInfo info = context.getPackageManager().getPackageInfo(engine, PackageManager.GET_PERMISSIONS);
        report.put("engineVersion", info.versionName);
        report.put("engineInternetPermission", context.getPackageManager().checkPermission(
            "android.permission.INTERNET", engine) == PackageManager.PERMISSION_GRANTED);
        report.put("defaultVoice", tts.getDefaultVoice() == null ? JSONObject.NULL : tts.getDefaultVoice().getName());
        report.put("maxInputLength", TextToSpeech.getMaxSpeechInputLength());
        JSONArray rows = new JSONArray();
        if (tts.getVoices() != null) for (Voice voice : tts.getVoices()) {
            JSONObject row = new JSONObject();
            row.put("id", voice.getName());
            row.put("language", voice.getLocale().toLanguageTag());
            row.put("networkRequired", voice.isNetworkConnectionRequired());
            row.put("features", voice.getFeatures() == null ? JSONObject.NULL : new JSONArray(voice.getFeatures()));
            row.put("selectable", usable(voice));
            rows.put(row);
        }
        report.put("voices", rows);
        return report;
    }
}
