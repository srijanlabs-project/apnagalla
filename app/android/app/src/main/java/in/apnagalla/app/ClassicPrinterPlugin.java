package in.apnagalla.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.UUID;

/**
 * Prints to thermal printers over classic Bluetooth (serial port profile), which most cheap
 * 2" / 3" ESC/POS billing printers use. The printer is paired once in Android's Bluetooth
 * settings; the app lists paired devices and sends raw ESC/POS bytes. No Google services.
 */
@CapacitorPlugin(
    name = "ClassicPrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class ClassicPrinterPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CHUNK = 1024;

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    /** Android 12+ asks for "Nearby devices" before Bluetooth can be used. */
    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "afterPermission");
            return;
        }
        doList(call);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "afterPermission");
            return;
        }
        doPrint(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (needsPermission()) {
            call.reject("Allow \"Nearby devices\" for ApnaGalla to use the Bluetooth printer.", "permission");
            return;
        }
        if ("print".equals(call.getMethodName())) doPrint(call);
        else doList(call);
    }

    @SuppressLint("MissingPermission")
    private void doList(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) {
            call.reject("This phone has no Bluetooth.", "no_bluetooth");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("Turn on Bluetooth first.", "bluetooth_off");
            return;
        }
        JSArray list = new JSArray();
        for (BluetoothDevice d : a.getBondedDevices()) {
            JSObject o = new JSObject();
            o.put("name", d.getName() == null ? d.getAddress() : d.getName());
            o.put("address", d.getAddress());
            list.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", list);
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    private void doPrint(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("Printer address and data are required.");
            return;
        }
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) {
            call.reject("Turn on Bluetooth first.", "bluetooth_off");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        getBridge().execute(() -> {
            BluetoothSocket socket = null;
            try {
                a.cancelDiscovery();
                BluetoothDevice device = a.getRemoteDevice(address);
                socket = connect(device);
                OutputStream out = socket.getOutputStream();
                for (int i = 0; i < bytes.length; i += CHUNK) {
                    out.write(bytes, i, Math.min(CHUNK, bytes.length - i));
                    out.flush();
                    // Small printers have small buffers: give them time to keep up.
                    Thread.sleep(25);
                }
                // Let the last bytes leave before closing the connection.
                Thread.sleep(400);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not print. Is the printer on, paired and near the phone?", "print_failed", e);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                        // already closed
                    }
                }
            }
        });
    }

    /** Standard serial connection, then the fallbacks some cheap printers need. */
    @SuppressLint("MissingPermission")
    private BluetoothSocket connect(BluetoothDevice device) throws Exception {
        try {
            BluetoothSocket s = device.createRfcommSocketToServiceRecord(SPP);
            s.connect();
            return s;
        } catch (Exception first) {
            try {
                BluetoothSocket s = device.createInsecureRfcommSocketToServiceRecord(SPP);
                s.connect();
                return s;
            } catch (Exception second) {
                Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                BluetoothSocket s = (BluetoothSocket) m.invoke(device, 1);
                s.connect();
                return s;
            }
        }
    }
}
