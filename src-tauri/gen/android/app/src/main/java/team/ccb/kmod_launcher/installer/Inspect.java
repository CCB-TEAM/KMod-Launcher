package team.ccb.kmod_launcher.installer;

import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.regex.Pattern;

/** Decides whether an APK can be injected (same checks as tools/kmod_inject.py). */
final class Inspect {
    static final class Report {
        boolean ok = true;
        final List<String> errors = new ArrayList<>(), warnings = new ArrayList<>();
        final Map<String, String> facts = new LinkedHashMap<>();
        boolean alreadyInjected;
        String patchClass = "", patchDex = "";
        boolean storedLibs;
        Object minSdk;
        void error(String m) { ok = false; errors.add(m); }
    }

    static final String[] ENGINE_LIBS = {"libUnreal.so", "libUE4.so", "libUE5.so"};

    /** Quick check used for the list of installed apps: is it a 64-bit Unreal game? (reads only the zip directory) */
    static boolean looksLikeUnreal(File apk) {
        try (ZipIo z = new ZipIo(apk)) {
            for (ZipIo.Entry e : z.entries) {
                if (!e.name.startsWith("lib/arm64-v8a/")) continue;
                String base = e.name.substring(e.name.lastIndexOf('/') + 1);
                for (String n : ENGINE_LIBS) if (base.equals(n)) return true;
            }
        } catch (Throwable t) { /* not a readable zip */ }
        return false;
    }

    static List<String> dexNames(ZipIo z) {
        List<String> out = new ArrayList<>();
        for (ZipIo.Entry e : z.entries) if (Pattern.matches("classes\\d*\\.dex", e.name)) out.add(e.name);
        Collections.sort(out, new Comparator<String>() {
            public int compare(String a, String b) { return Integer.compare(num(a), num(b)); }
            int num(String s) { String d = s.replaceAll("\\D", ""); return d.isEmpty() ? 1 : Integer.parseInt(d); }
        });
        return out;
    }

    static int indexOf(byte[] hay, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= hay.length; i++) {
            if (hay[i] != needle[0]) continue;
            for (int k = 1; k < needle.length; k++) if (hay[i + k] != needle[k]) continue outer;
            return i;
        }
        return -1;
    }

    static Report analyze(File apk, boolean readEngineVersion) {
        Report r = new Report();
        try (ZipIo z = new ZipIo(apk)) {
            ZipIo.Entry man = z.find("AndroidManifest.xml");
            List<String> dexes = dexNames(z);
            if (man == null || dexes.isEmpty()) { r.error("没有 AndroidManifest.xml / classes.dex：这不是完整的 APK（分包安装的应用暂不支持）"); return r; }
            Axml m;
            try { m = Axml.parse(z.read(man)); } catch (Exception e) { r.error("无法读取 AndroidManifest.xml：" + e.getMessage()); return r; }
            r.facts.put("包名", m.pkg);
            r.minSdk = m.minSdk;
            r.facts.put("minSdk / targetSdk", m.minSdk + " / " + m.targetSdk);
            r.storedLibs = Boolean.FALSE.equals(m.extractNativeLibs);
            String launcher = m.launcherClass(), app = m.full(m.appName);
            r.facts.put("启动类", launcher.isEmpty() ? "(无)" : launcher);

            // architecture and engine
            List<ZipIo.Entry> arm64 = new ArrayList<>();
            for (ZipIo.Entry e : z.entries) if (e.name.startsWith("lib/arm64-v8a/")) arm64.add(e);
            ZipIo.Entry engine = null;
            for (ZipIo.Entry e : arm64) for (String n : ENGINE_LIBS) if (e.name.endsWith("/" + n)) engine = e;
            if (arm64.isEmpty()) r.error("没有 lib/arm64-v8a/：只支持 64 位 ARM 的游戏");
            if (engine == null) r.error("lib/arm64-v8a/ 里没有虚幻引擎库（libUnreal.so / libUE4.so）：不是虚幻游戏，或者库在分包里");
            else {
                r.facts.put("引擎库", engine.name.substring(engine.name.lastIndexOf('/') + 1));
                if (readEngineVersion) {
                    String v = engineVersion(z, engine);
                    r.facts.put("引擎版本", v == null ? "(未找到)" : v);
                    if (v == null) r.warnings.add("在引擎库里没有找到版本字符串");
                }
            }

            // what to patch
            String target = !launcher.isEmpty() ? launcher : app;
            if (target.isEmpty()) r.error("清单里既没有启动 Activity，也没有 Application 类");
            else {
                byte[] needle = ("L" + target.replace('.', '/') + ";").getBytes("UTF-8");
                String found = null;
                for (String d : dexes) if (indexOf(z.read(z.find(d)), needle) >= 0) { found = d; break; }
                if (found == null) r.error("类 " + target + " 不在任何 classes*.dex 里");
                else { r.patchClass = target; r.patchDex = found; r.facts.put("补丁位置", target + "（" + found + "）"); }
            }

            // already injected? anti-tamper?
            if (z.has("lib/arm64-v8a/libkmod.so")) { r.alreadyInjected = true; r.warnings.add("这个 APK 已经包含 kmod（再次注入会替换其中的文件）"); }
            for (ZipIo.Entry e : arm64) if (e.name.endsWith("/libpairipcore.so")) r.warnings.add("防篡改：Google PairIP（应用会校验自己的签名和完整性），重新签名的包可能无法运行");
            Set<String> seen = new HashSet<>();
            for (String d : dexes) {
                byte[] b = z.read(z.find(d));
                if (indexOf(b, "Lcom/google/android/vending/licensing/".getBytes("UTF-8")) >= 0 && seen.add("lvl")) r.warnings.add("防篡改：Google Play 授权库（LVL），重新签名的包可能无法运行");
                if (indexOf(b, "Lcom/pairip/".getBytes("UTF-8")) >= 0 && seen.add("pairip")) r.warnings.add("防篡改：Google PairIP，重新签名的包可能无法运行");
            }
            if (m.targetSdk instanceof Integer && (Integer) m.targetSdk < 24) r.warnings.add("targetSdkVersion " + m.targetSdk + " 太旧：Android 14 以后拒绝安装低于 23 的应用");
        } catch (IOException e) {
            r.error("无法读取 APK：" + e.getMessage());
        }
        return r;
    }

    /** "5.6" from the engine's branch string ("++UE5+Release-5.6", stored as UTF-16 in the library). */
    static String engineVersion(ZipIo z, ZipIo.Entry engine) throws IOException {
        final String[] result = {null};
        final byte[][] carry = {new byte[0]};
        z.stream(engine, new ZipIo.Sink() {
            public void accept(byte[] buf, int len) {
                if (result[0] != null) return;
                byte[] w = new byte[carry[0].length + len];
                System.arraycopy(carry[0], 0, w, 0, carry[0].length);
                System.arraycopy(buf, 0, w, carry[0].length, len);
                int n = w.length - 64;
                for (int i = 0; i < n && result[0] == null; i++) {
                    if (w[i] != 'U') continue;
                    String v = matchAscii(w, i);
                    if (v == null) v = matchWide(w, i);
                    if (v != null) result[0] = v;
                }
                int keep = Math.min(64, w.length);
                carry[0] = new byte[keep];
                System.arraycopy(w, w.length - keep, carry[0], 0, keep);
            }
        });
        return result[0];
    }

    private static String matchAscii(byte[] w, int i) {
        String head = "UE5+Release-";
        if (w[i + 1] != 'E' || (w[i + 2] != '4' && w[i + 2] != '5') || w[i + 3] != '+') return null;
        for (int k = 4; k < head.length(); k++) if (w[i + k] != head.charAt(k)) return null;
        StringBuilder sb = new StringBuilder();
        for (int p = i + head.length(); p < w.length && sb.length() < 8 && (Character.isDigit(w[p]) || w[p] == '.'); p++) sb.append((char) w[p]);
        return sb.length() > 2 && sb.indexOf(".") > 0 ? sb.toString() : null;
    }

    private static String matchWide(byte[] w, int i) {
        String head = "UE5+Release-";
        if (w[i + 1] != 0 || w[i + 2] != 'E' || w[i + 3] != 0 || (w[i + 4] != '4' && w[i + 4] != '5') || w[i + 5] != 0 || w[i + 6] != '+') return null;
        for (int k = 4; k < head.length(); k++) if (w[i + k * 2] != head.charAt(k) || w[i + k * 2 + 1] != 0) return null;
        StringBuilder sb = new StringBuilder();
        for (int p = i + head.length() * 2; p + 1 < w.length && sb.length() < 8 && w[p + 1] == 0 && (Character.isDigit(w[p]) || w[p] == '.'); p += 2) sb.append((char) w[p]);
        return sb.length() > 2 && sb.indexOf(".") > 0 ? sb.toString() : null;
    }
}
