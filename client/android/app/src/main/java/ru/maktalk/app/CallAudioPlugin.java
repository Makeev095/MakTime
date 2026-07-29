package ru.maktalk.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {
    private boolean speakerEnabled = true;

    @PluginMethod
    public void startCallAudio(PluginCall call) {
        Boolean speaker = call.getBoolean("speaker", true);
        speakerEnabled = speaker == null || speaker;
        applyRoute();
        JSObject result = new JSObject();
        result.put("route", speakerEnabled ? "speaker" : "earpiece");
        call.resolve(result);
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required");
            return;
        }
        speakerEnabled = enabled;
        applyRoute();
        JSObject result = new JSObject();
        result.put("route", speakerEnabled ? "speaker" : "earpiece");
        call.resolve(result);
    }

    @PluginMethod
    public void stopCallAudio(PluginCall call) {
        AudioManager am = getAudioManager();
        if (am != null) {
            am.setMode(AudioManager.MODE_NORMAL);
            am.setSpeakerphoneOn(false);
        }
        call.resolve();
    }

    private void applyRoute() {
        AudioManager am = getAudioManager();
        if (am == null) return;
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        am.setSpeakerphoneOn(speakerEnabled);
    }

    private AudioManager getAudioManager() {
        Context context = getContext();
        if (context == null) return null;
        return (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }
}
