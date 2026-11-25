package team.ccb.kmod_launcher.installer;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The kmod installer, built into the launcher: find installed Unreal games, check them, inject the loader,
 * sign with a key of our own, and hand the result to the system installer. The steps live in the sibling
 * classes (Inspect, Injector, DexPatch, Keys, ZipIo, Axml); this class is the state machine around them.
 *
 * The UI polls {@link #status()}: phase is idle | working | need_uninstall | installing | done | error.
 */
public final class Installer {
    private static final String ACTION_RESULT = "team.ccb.kmod_launcher.INSTALL_RESULT";
    /** Where the stand-alone installer app kept its signing key: reused so games it injected can be updated in place. */
    private static final String OLD_INSTALLER_MEDIA = "/sdcard/Android/media/kmod.installer/signing";

    private static String phase = "idle", text = "", message = "", pkg = "", label = "";
    private static File output;
    private static Keys keys;
    private static boolean registered;

    private Installer() {}

    // ------------------------------------------------------------------------------------------ lists and checks

    /** The loader flavors bundled in assets/loader/. */
    public static JSONArray flavors(Context c) {
        JSONArray a = new JSONArray();
        try {
            String[] l = c.getAssets().list("loader");
            if (l != null) {
                Arrays.sort(l);
                for (String f : l) {
                    String[] files = c.getAssets().list("loader/" + f);
                    if (files != null && files.length >= 2) a.put(f);
                }
            }
        } catch (Exception ignored) { }
        return a;
    }

    public static JSONArray scan(Context c) throws Exception {
        PackageManager pm = c.getPackageManager();
        List<JSONObject> out = new ArrayList<>();
        for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
            if ((ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0 || ai.packageName.equals(c.getPackageName())) continue;
            if (ai.sourceDir == null || !Inspect.looksLikeUnreal(new File(ai.sourceDir))) continue;
            JSONObject o = new JSONObject();
            o.put("label", String.valueOf(pm.getApplicationLabel(ai)));
            o.put("pkg", ai.packageName);
            o.put("path", ai.sourceDir);
            o.put("split", ai.splitSourceDirs != null && ai.splitSourceDirs.length > 0);
            out.add(o);
        }
        Collections.sort(out, new Comparator<JSONObject>() {
            public int compare(JSONObject x, JSONObject y) { return x.optString("label").compareToIgnoreCase(y.optString("label")); }
        });
        return new JSONArray(out);
    }

    public static JSONObject inspect(String path, boolean split) throws Exception {
        Inspect.Report r = Inspect.analyze(new File(path), true);
        if (split) r.error("这个应用是分包安装的，暂不支持");
        JSONObject o = new JSONObject();
        o.put("ok", r.ok && !split);
        JSONArray facts = new JSONArray();
        for (Map.Entry<String, String> e : r.facts.entrySet()) facts.put(new JSONArray().put(e.getKey()).put(e.getValue()));
        o.put("facts", facts);
        o.put("warnings", new JSONArray(r.warnings));
        o.put("errors", new JSONArray(r.errors));
        o.put("alreadyInjected", r.alreadyInjected);
        return o;
    }

    // ------------------------------------------------------------------------------------------ state

    private static synchronized void set(String ph, String t, String m) { phase = ph; text = t; message = m; }

    public static synchronized JSONObject status() throws Exception {
        JSONObject o = new JSONObject();
        o.put("phase", phase); o.put("text", text); o.put("message", message); o.put("pkg", pkg); o.put("label", label);
        o.put("size", output != null && output.exists() ? output.length() : 0);
        return o;
    }

    public static synchronized void reset() {
        if (phase.equals("working") || phase.equals("installing")) return;
        phase = "idle"; text = ""; message = ""; pkg = ""; label = "";
        if (output != null) output.delete();
        output = null;
    }

    // ------------------------------------------------------------------------------------------ inject

    public static void register(final Context app) {
        if (registered) return;
        registered = true;
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { onResult(c, i); }
        };
        IntentFilter f = new IntentFilter(ACTION_RESULT);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED); else app.registerReceiver(r, f);
    }

    public static boolean canInstall(Context c) {
        return Build.VERSION.SDK_INT < 26 || c.getPackageManager().canRequestPackageInstalls();
    }

    public static void start(final Context c, final String pkgName, final String appLabel, final String path, final String flavor) {
        synchronized (Installer.class) {
            if (phase.equals("working") || phase.equals("installing")) return;
            pkg = pkgName; label = appLabel; output = null;
            set("working", "准备", "");
        }
        new Thread(new Runnable() { public void run() {
            try {
                // signing key: private storage, backed up to our media folder; or the old installer app's key
                File[] media = c.getExternalMediaDirs();
                File backup = media.length > 0 && media[0] != null ? new File(media[0], "signing") : null;
                File priv = new File(c.getFilesDir(), "keys");
                if (!new File(priv, "signing.pk8").exists() && (backup == null || !new File(backup, "signing.pk8").exists())) {
                    File old = new File(OLD_INSTALLER_MEDIA);
                    if (new File(old, "signing.pk8").exists() && new File(old, "signing.crt").exists()) backup = old;
                }
                keys = Keys.loadOrCreate(priv, backup);

                Map<String, byte[]> libs = new LinkedHashMap<>();
                for (String n : new String[]{"libkmod.so", "libkmodcore.so"}) libs.put(n, readAsset(c, "loader/" + flavor + "/" + n));
                File outDir = media.length > 0 && media[0] != null ? media[0] : c.getCacheDir();   // large: keep it on shared storage
                File out = new File(outDir, pkgName + "-kmod.apk");
                Injector.run(new File(path), out, libs, keys, new File(c.getCacheDir(), "work"), new Injector.Progress() {
                    public void step(String t) { set("working", t, ""); }
                });
                output = out;
                afterInject(c);
            } catch (Throwable t) {
                t.printStackTrace();
                set("error", "注入失败", String.valueOf(t));
            }
        } }).start();
    }

    private static byte[] readAsset(Context c, String name) throws Exception {
        try (InputStream in = c.getAssets().open(name)) {
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[1 << 16]; int n;
            while ((n = in.read(b)) > 0) o.write(b, 0, n);
            return o.toByteArray();
        }
    }

    private static boolean installed(Context c, String p) {
        try { c.getPackageManager().getPackageInfo(p, 0); return true; } catch (PackageManager.NameNotFoundException e) { return false; }
    }

    /** Already signed with our key? Then it can be updated in place, without uninstalling the original. */
    private static boolean signedByUs(Context c, String p) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(p, PackageManager.GET_SIGNING_CERTIFICATES);
            if (pi.signingInfo == null) return false;
            for (Signature s : pi.signingInfo.getApkContentsSigners())
                if (Arrays.equals(s.toByteArray(), keys.cert.getEncoded())) return true;
        } catch (Exception ignored) { }
        return false;
    }

    private static void afterInject(Context c) {
        if (installed(c, pkg) && !signedByUs(c, pkg)) set("need_uninstall", "注入完成", "原版应用的签名和注入后的不同，必须先卸载原版。卸载会删除它的应用数据（账号通常在服务器上；kmod 的模组文件夹不受影响）。");
        else install(c);
    }

    /** Opens the system's uninstall confirmation for the original game. */
    public static void uninstall(Activity a) {
        a.startActivity(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg)));
    }

    /** After the user came back from uninstalling: install if the original is gone. */
    public static void proceed(Context c) {
        if (!phase.equals("need_uninstall")) return;
        if (installed(c, pkg) && !signedByUs(c, pkg)) set("need_uninstall", "注入完成", "原版还没有卸载。点“卸载原版”，在系统弹窗里确认。");
        else install(c);
    }

    private static void install(final Context c) {
        set("installing", "正在安装（系统会弹出确认窗口）", "");
        new Thread(new Runnable() { public void run() {
            try {
                PackageInstaller pi = c.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                sp.setAppPackageName(pkg);
                int id = pi.createSession(sp);
                try (PackageInstaller.Session s = pi.openSession(id)) {
                    try (OutputStream os = s.openWrite("base.apk", 0, output.length()); InputStream in = new FileInputStream(output)) {
                        byte[] buf = new byte[1 << 16]; int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                        s.fsync(os);
                    }
                    Intent i = new Intent(ACTION_RESULT).setPackage(c.getPackageName());
                    PendingIntent pend = PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    s.commit(pend.getIntentSender());
                }
            } catch (Throwable t) { set("error", "安装失败", String.valueOf(t)); }
        } }).start();
    }

    private static void onResult(Context c, Intent i) {
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); c.startActivity(confirm); }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            if (output != null) output.delete();
            set("done", "安装完成", "");
        } else {
            set("error", "系统拒绝了安装（" + status + "）", msg == null ? "" : msg);
        }
    }
}
