package team.ccb.kmod_launcher.installer;

import com.android.apksig.ApkSigner;

import java.io.*;
import java.util.*;
import java.util.regex.Pattern;

/** The injection pipeline: patch the launcher class, add the loader libraries, drop the old signature, sign. */
final class Injector {
    interface Progress { void step(String text); }

    /** libs: file name inside lib/arm64-v8a/ -> bytes */
    static void run(File inApk, File outApk, Map<String, byte[]> libs, Keys keys, File workDir, Progress p) throws Exception {
        p.step("检查 APK");
        Inspect.Report rep = Inspect.analyze(inApk, false);
        if (!rep.ok) throw new IOException(rep.errors.get(0));
        workDir.mkdirs();
        File unsigned = new File(workDir, "unsigned.apk");
        File dexIn = new File(workDir, "in.dex"), dexOut = new File(workDir, "out.dex");
        try {
            try (ZipIo z = new ZipIo(inApk)) {
                p.step("修改 " + rep.patchDex + " 里的 " + rep.patchClass);
                byte[] dex = z.read(z.find(rep.patchDex));
                try (FileOutputStream o = new FileOutputStream(dexIn)) { o.write(dex); }
                DexPatch.patch(dexIn, dexOut, "L" + rep.patchClass.replace('.', '/') + ";", "kmod");
                byte[] patched = readAll(dexOut);

                p.step("重新打包（不重新压缩）");
                Pattern sig = Pattern.compile("^META-INF/[^/]+\\.(SF|RSA|DSA|EC|MF)$");
                try (ZipIo.Writer w = new ZipIo.Writer(unsigned)) {
                    for (ZipIo.Entry e : z.entries) {
                        if (sig.matcher(e.name).matches()) continue;
                        if (libs.containsKey(e.name.startsWith("lib/arm64-v8a/") ? e.name.substring("lib/arm64-v8a/".length()) : "\0")) continue;
                        if (e.name.equals(rep.patchDex)) { w.add(e.name, patched, true); continue; }
                        w.copy(z, e);
                    }
                    for (Map.Entry<String, byte[]> l : libs.entrySet()) w.add("lib/arm64-v8a/" + l.getKey(), l.getValue(), false);
                }
            }
            p.step("签名（这一步要读写整个 APK，需要一两分钟）");
            int minSdk = rep.minSdk instanceof Integer ? (Integer) rep.minSdk : 24;
            ApkSigner.SignerConfig sc = new ApkSigner.SignerConfig.Builder("kmod", keys.key, Collections.singletonList(keys.cert)).build();
            new ApkSigner.Builder(Collections.singletonList(sc))
                    .setInputApk(unsigned).setOutputApk(outApk)
                    .setMinSdkVersion(minSdk)
                    .setV1SigningEnabled(minSdk < 24).setV2SigningEnabled(true).setV3SigningEnabled(true)
                    .build().sign();
        } finally {
            unsigned.delete(); dexIn.delete(); dexOut.delete();
        }
    }

    private static byte[] readAll(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[1 << 16]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n); return o.toByteArray(); }
    }
}
