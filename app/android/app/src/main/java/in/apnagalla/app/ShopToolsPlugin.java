package in.apnagalla.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Small native helpers the web side can't do:
 *  - whatsAppFile: opens WhatsApp in one number's chat with a file attached (the seller taps send),
 *    even when the number isn't in the phone's contacts (WhatsApp's "jid" extra);
 *  - printTcp: sends ESC/POS bytes to a Wi-Fi receipt printer (raw TCP, usually port 9100);
 *  - printPdf: opens Android's print screen for a PDF (any Wi-Fi / Mopria printer).
 * No Google services needed.
 */
@CapacitorPlugin(name = "ShopTools")
public class ShopToolsPlugin extends Plugin {

    private static final String[] WHATSAPP = { "com.whatsapp", "com.whatsapp.w4b" };

    private boolean installed(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** A file in the app's cache, written by the web side (Filesystem.Directory.Cache). */
    private File cacheFile(String name) {
        return new File(getContext().getCacheDir(), name);
    }

    @PluginMethod
    public void whatsAppFile(PluginCall call) {
        String phone = call.getString("phone", "").replaceAll("[^0-9]", "");
        String name = call.getString("fileName");
        String mime = call.getString("mime", "application/pdf");
        String text = call.getString("text", "");
        if (phone.length() < 10 || name == null) {
            call.reject("Phone number and file are needed");
            return;
        }
        if (phone.length() == 10) phone = "91" + phone;
        String pkg = null;
        for (String p : WHATSAPP) if (installed(p)) { pkg = p; break; }
        if (pkg == null) {
            call.reject("WhatsApp is not installed", "NOT_INSTALLED");
            return;
        }
        File file = cacheFile(name);
        if (!file.exists()) {
            call.reject("File not found");
            return;
        }
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType(mime);
        intent.setPackage(pkg);
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        if (!text.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text);
        intent.putExtra("jid", phone + "@s.whatsapp.net");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("WhatsApp could not open", "NOT_INSTALLED");
        }
    }

    @PluginMethod
    public void printTcp(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 9100);
        String data = call.getString("data");
        if (host == null || data == null) {
            call.reject("Printer address and data are needed");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        new Thread(() -> {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(host, port), 5000);
                s.setSoTimeout(10000);
                OutputStream out = s.getOutputStream();
                for (int i = 0; i < bytes.length; i += 2048) {
                    out.write(bytes, i, Math.min(2048, bytes.length - i));
                    out.flush();
                }
                // Give the printer a moment before closing, or some drop the tail.
                Thread.sleep(300);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not reach the printer at " + host + ":" + port + " (" + e.getMessage() + ")");
            }
        }).start();
    }

    @PluginMethod
    public void printPdf(PluginCall call) {
        String name = call.getString("fileName");
        String title = call.getString("title", "ApnaGalla");
        File file = name == null ? null : cacheFile(name);
        if (file == null || !file.exists()) {
            call.reject("File not found");
            return;
        }
        getActivity().runOnUiThread(() -> {
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            pm.print(title, new PrintDocumentAdapter() {
                @Override
                public void onLayout(PrintAttributes oldA, PrintAttributes newA, CancellationSignal cancel, LayoutResultCallback cb, Bundle extras) {
                    if (cancel.isCanceled()) {
                        cb.onLayoutCancelled();
                        return;
                    }
                    cb.onLayoutFinished(new PrintDocumentInfo.Builder(name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true);
                }

                @Override
                public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal cancel, WriteResultCallback cb) {
                    try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(dest.getFileDescriptor())) {
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        cb.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
                    } catch (Exception e) {
                        cb.onWriteFailed(e.getMessage());
                    }
                }
            }, null);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
    }

    @SuppressWarnings("unused")
    private JSObject ok() {
        JSObject r = new JSObject();
        r.put("ok", true);
        return r;
    }
}
