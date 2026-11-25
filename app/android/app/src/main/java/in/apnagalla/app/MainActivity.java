package in.apnagalla.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugins must be registered before the bridge starts.
        registerPlugin(ClassicPrinterPlugin.class);
        registerPlugin(ShopToolsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
