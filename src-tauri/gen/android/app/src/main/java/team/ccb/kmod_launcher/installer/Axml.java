package team.ccb.kmod_launcher.installer;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/** Minimal reader for the binary AndroidManifest.xml: package, Application class, launcher Activity, SDK levels. */
final class Axml {
    static final class Activity { String name, aliasTarget; boolean alias, launcher; }

    String pkg = "", appName = "";
    Object minSdk, targetSdk, extractNativeLibs;
    final List<Activity> activities = new ArrayList<>();

    static Axml parse(byte[] data) {
        ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        if ((b.getShort(0) & 0xFFFF) != 0x0003) throw new IllegalArgumentException("AndroidManifest.xml is not binary XML");
        Axml r = new Axml();
        String[] strings = new String[0];
        int pos = b.getShort(2) & 0xFFFF;
        Activity cur = null;
        boolean fMain = false, fLauncher = false, inFilter = false;
        while (pos + 8 <= data.length) {
            int type = b.getShort(pos) & 0xFFFF;
            int size = b.getInt(pos + 4);
            if (type == 0x0001) strings = pool(b, pos);
            else if (type == 0x0102) {
                int nameI = b.getInt(pos + 20);
                int attrStart = b.getShort(pos + 24) & 0xFFFF, attrSize = b.getShort(pos + 26) & 0xFFFF, attrCount = b.getShort(pos + 28) & 0xFFFF;
                String tag = strings[nameI];
                String[] keys = new String[attrCount];
                Object[] vals = new Object[attrCount];
                for (int i = 0; i < attrCount; i++) {
                    int a = pos + 16 + attrStart + i * attrSize;
                    keys[i] = strings[b.getInt(a + 4)];
                    int raw = b.getInt(a + 8), vtype = b.get(a + 15) & 0xFF, vdata = b.getInt(a + 16);
                    if (raw != -1) vals[i] = strings[raw];
                    else if (vtype == 0x03) vals[i] = strings[vdata];
                    else if (vtype == 0x12) vals[i] = vdata != 0;
                    else vals[i] = vdata;
                }
                if (tag.equals("manifest")) r.pkg = str(keys, vals, "package");
                else if (tag.equals("uses-sdk")) { r.minSdk = get(keys, vals, "minSdkVersion"); r.targetSdk = get(keys, vals, "targetSdkVersion"); }
                else if (tag.equals("application")) { r.appName = str(keys, vals, "name"); r.extractNativeLibs = get(keys, vals, "extractNativeLibs"); }
                else if (tag.equals("activity") || tag.equals("activity-alias")) {
                    cur = new Activity();
                    cur.name = str(keys, vals, "name"); cur.alias = tag.equals("activity-alias"); cur.aliasTarget = str(keys, vals, "targetActivity");
                    r.activities.add(cur);
                } else if (tag.equals("intent-filter")) { inFilter = true; fMain = false; fLauncher = false; }
                else if (tag.equals("action") && inFilter && "android.intent.action.MAIN".equals(get(keys, vals, "name"))) fMain = true;
                else if (tag.equals("category") && inFilter && "android.intent.category.LAUNCHER".equals(get(keys, vals, "name"))) fLauncher = true;
            } else if (type == 0x0103) {
                String tag = strings[b.getInt(pos + 20)];
                if (tag.equals("intent-filter")) { if (fMain && fLauncher && cur != null) cur.launcher = true; inFilter = false; }
                else if (tag.equals("activity") || tag.equals("activity-alias")) cur = null;
            }
            pos += size > 0 ? size : 8;
        }
        return r;
    }

    private static Object get(String[] k, Object[] v, String key) { for (int i = 0; i < k.length; i++) if (k[i].equals(key)) return v[i]; return null; }
    private static String str(String[] k, Object[] v, String key) { Object o = get(k, v, key); return o instanceof String ? (String) o : ""; }

    private static String[] pool(ByteBuffer b, int off) {
        int hdr = b.getShort(off + 2) & 0xFFFF, count = b.getInt(off + 8), flags = b.getInt(off + 16), start = b.getInt(off + 20);
        boolean utf8 = (flags & 0x100) != 0;
        String[] out = new String[count];
        for (int i = 0; i < count; i++) {
            int p = off + start + b.getInt(off + hdr + i * 4);
            if (utf8) {
                int n = b.get(p++) & 0xFF; if ((n & 0x80) != 0) { n = ((n & 0x7F) << 8) | (b.get(p++) & 0xFF); }
                int len = b.get(p++) & 0xFF; if ((len & 0x80) != 0) { len = ((len & 0x7F) << 8) | (b.get(p++) & 0xFF); }
                byte[] t = new byte[len]; for (int k = 0; k < len; k++) t[k] = b.get(p + k);
                out[i] = new String(t, Charset.forName("UTF-8"));
            } else {
                int n = b.getShort(p) & 0xFFFF; p += 2;
                if ((n & 0x8000) != 0) { n = ((n & 0x7FFF) << 16) | (b.getShort(p) & 0xFFFF); p += 2; }
                char[] c = new char[n]; for (int k = 0; k < n; k++) c[k] = (char) (b.getShort(p + k * 2) & 0xFFFF);
                out[i] = new String(c);
            }
        }
        return out;
    }

    String full(String name) {
        if (name == null || name.isEmpty()) return "";
        if (name.startsWith(".")) return pkg + name;
        if (!name.contains(".")) return pkg + "." + name;
        return name;
    }

    /** The class to patch: the launcher Activity (an alias resolves to its target), else "". */
    String launcherClass() {
        for (Activity a : activities)
            if (a.launcher) return full(a.alias && a.aliasTarget != null && !a.aliasTarget.isEmpty() ? a.aliasTarget : a.name);
        return "";
    }
}
