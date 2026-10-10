package dev.jingye.reader;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private JyNativePlugin jyNative;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JyNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        plugin();
        if (jyNative != null) jyNative.onNewIntent(intent);
    }

    /** 音量键翻页：仅当阅读页开关打开时消费；长按重复事件消费但不重复翻页。 */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if ((code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)
                && event.getAction() == KeyEvent.ACTION_DOWN
                && plugin() != null && jyNative.wantsVolumeKeys()) {
            if (event.getRepeatCount() == 0) jyNative.onVolumeKey(code);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private JyNativePlugin plugin() {
        if (jyNative == null && getBridge() != null) {
            var handle = getBridge().getPlugin("JyNative");
            if (handle != null) jyNative = (JyNativePlugin) handle.getInstance();
        }
        return jyNative;
    }
}
