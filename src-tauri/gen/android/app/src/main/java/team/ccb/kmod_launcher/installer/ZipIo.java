package team.ccb.kmod_launcher.installer;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.Charset;
import java.util.*;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/**
 * A zip reader and rewriter that copies entries WITHOUT recompressing them: the compressed bytes are copied as they are,
 * so a 1.2 GB APK is rewritten at disk speed, and stored entries can be aligned (4 bytes; 4096 for .so files, like zipalign -p).
 */
final class ZipIo implements Closeable {
    static final class Entry {
        String name; int flags, method, time, date, crc; long csize, usize, localOffset; int externalAttr, internalAttr;
        boolean isDir() { return name.endsWith("/"); }
    }

    final RandomAccessFile f;
    final List<Entry> entries = new ArrayList<>();
    private static final Charset UTF8 = Charset.forName("UTF-8");

    ZipIo(File file) throws IOException {
        f = new RandomAccessFile(file, "r");
        long len = f.length();
        int max = (int) Math.min(len, 66000);
        byte[] tail = new byte[max];
        f.seek(len - max); f.readFully(tail);
        int eocd = -1;
        for (int i = max - 22; i >= 0; i--) if (tail[i] == 0x50 && tail[i + 1] == 0x4b && tail[i + 2] == 5 && tail[i + 3] == 6) { eocd = i; break; }
        if (eocd < 0) throw new IOException("not a zip file");
        ByteBuffer e = ByteBuffer.wrap(tail).order(ByteOrder.LITTLE_ENDIAN);
        int count = e.getShort(eocd + 10) & 0xFFFF;
        long cdSize = e.getInt(eocd + 12) & 0xFFFFFFFFL, cdOff = e.getInt(eocd + 16) & 0xFFFFFFFFL;
        if (count == 0xFFFF || cdOff == 0xFFFFFFFFL) throw new IOException("zip64 archives are not supported");
        byte[] cd = new byte[(int) cdSize];
        f.seek(cdOff); f.readFully(cd);
        ByteBuffer c = ByteBuffer.wrap(cd).order(ByteOrder.LITTLE_ENDIAN);
        int p = 0;
        for (int i = 0; i < count; i++) {
            if (c.getInt(p) != 0x02014b50) throw new IOException("corrupt central directory");
            Entry en = new Entry();
            en.flags = c.getShort(p + 8) & 0xFFFF; en.method = c.getShort(p + 10) & 0xFFFF;
            en.time = c.getShort(p + 12) & 0xFFFF; en.date = c.getShort(p + 14) & 0xFFFF;
            en.crc = c.getInt(p + 16); en.csize = c.getInt(p + 20) & 0xFFFFFFFFL; en.usize = c.getInt(p + 24) & 0xFFFFFFFFL;
            int nl = c.getShort(p + 28) & 0xFFFF, xl = c.getShort(p + 30) & 0xFFFF, cl = c.getShort(p + 32) & 0xFFFF;
            en.internalAttr = c.getShort(p + 36) & 0xFFFF; en.externalAttr = c.getInt(p + 38); en.localOffset = c.getInt(p + 42) & 0xFFFFFFFFL;
            en.name = new String(cd, p + 46, nl, UTF8);
            entries.add(en);
            p += 46 + nl + xl + cl;
        }
    }

    Entry find(String name) { for (Entry e : entries) if (e.name.equals(name)) return e; return null; }
    boolean has(String name) { return find(name) != null; }

    private long dataStart(Entry e) throws IOException {
        byte[] h = new byte[30];
        f.seek(e.localOffset); f.readFully(h);
        ByteBuffer b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN);
        if (b.getInt(0) != 0x04034b50) throw new IOException("corrupt local header for " + e.name);
        return e.localOffset + 30 + (b.getShort(26) & 0xFFFF) + (b.getShort(28) & 0xFFFF);
    }

    /** The uncompressed bytes of an entry (small entries: manifest, dex). */
    byte[] read(Entry e) throws IOException {
        if (e.usize > 200L * 1024 * 1024) throw new IOException("entry too large to read into memory: " + e.name);
        byte[] raw = new byte[(int) e.csize];
        f.seek(dataStart(e)); f.readFully(raw);
        if (e.method == 0) return raw;
        Inflater inf = new Inflater(true);
        inf.setInput(raw);
        byte[] out = new byte[(int) e.usize];
        try {
            int n = 0;
            while (n < out.length) { int k = inf.inflate(out, n, out.length - n); if (k == 0 && (inf.finished() || inf.needsInput())) break; n += k; }
        } catch (Exception ex) { throw new IOException("cannot inflate " + e.name, ex); } finally { inf.end(); }
        return out;
    }

    /** Streams the uncompressed content of an entry through `sink`. */
    interface Sink { void accept(byte[] buf, int len) throws IOException; }
    void stream(Entry e, Sink sink) throws IOException {
        f.seek(dataStart(e));
        long left = e.csize;
        byte[] in = new byte[1 << 16], out = new byte[1 << 16];
        Inflater inf = e.method == 0 ? null : new Inflater(true);
        try {
            while (left > 0 || (inf != null && !inf.finished() && !inf.needsInput())) {
                if (inf == null || inf.needsInput()) {
                    if (left <= 0) break;
                    int n = f.read(in, 0, (int) Math.min(in.length, left));
                    if (n <= 0) break;
                    left -= n;
                    if (inf == null) { sink.accept(in, n); continue; }
                    inf.setInput(in, 0, n);
                }
                int k;
                while (inf != null && (k = inf.inflate(out)) > 0) sink.accept(out, k);
            }
        } catch (java.util.zip.DataFormatException ex) { throw new IOException("cannot inflate " + e.name, ex); }
        finally { if (inf != null) inf.end(); }
    }

    @Override public void close() throws IOException { f.close(); }

    // ------------------------------------------------------------------------------------------------ writer
    static final class Writer implements Closeable {
        private final OutputStream os;
        private long pos = 0;
        private final ByteArrayOutputStream cd = new ByteArrayOutputStream();
        private int count = 0;
        Writer(File out) throws IOException { os = new BufferedOutputStream(new FileOutputStream(out), 1 << 20); }

        private void u16(OutputStream o, int v) throws IOException { o.write(v); o.write(v >>> 8); }
        private void u32(OutputStream o, long v) throws IOException { o.write((int) v); o.write((int) (v >>> 8)); o.write((int) (v >>> 16)); o.write((int) (v >>> 24)); }

        private int alignFor(String name, int method) { return method != 0 ? 0 : (name.endsWith(".so") ? 4096 : 4); }

        private void header(String name, int flags, int method, int time, int date, int crc, long csize, long usize, int internalAttr, int externalAttr) throws IOException {
            byte[] nb = name.getBytes(UTF8);
            int align = alignFor(name, method);
            int pad = 0;
            if (align > 0) {
                pad = (int) ((align - (pos + 30 + nb.length) % align) % align);
                if (pad > 0 && pad < 4) pad += align;                       // an extra field is at least 4 bytes
            }
            flags &= ~8;                                                   // sizes and crc are in the header: no data descriptor
            long local = pos;
            u32(os, 0x04034b50L); u16(os, 20); u16(os, flags); u16(os, method); u16(os, time); u16(os, date);
            u32(os, crc & 0xFFFFFFFFL); u32(os, csize); u32(os, usize); u16(os, nb.length); u16(os, pad);
            os.write(nb);
            if (pad > 0) { u16(os, 0xD935); u16(os, pad - 4); for (int i = 0; i < pad - 4; i++) os.write(0); }
            pos += 30 + nb.length + pad;
            u32(cd, 0x02014b50L); u16(cd, 0x031E); u16(cd, 20); u16(cd, flags); u16(cd, method); u16(cd, time); u16(cd, date);
            u32(cd, crc & 0xFFFFFFFFL); u32(cd, csize); u32(cd, usize); u16(cd, nb.length); u16(cd, 0); u16(cd, 0); u16(cd, 0);
            u16(cd, internalAttr); u32(cd, externalAttr & 0xFFFFFFFFL); u32(cd, local);
            cd.write(nb);
            count++;
        }

        /** Copies an entry of `src` as it is (no recompression). */
        void copy(ZipIo src, Entry e) throws IOException {
            header(e.name, e.flags, e.method, e.time, e.date, e.crc, e.csize, e.usize, e.internalAttr, e.externalAttr);
            long start = src.dataStart(e);
            src.f.seek(start);
            byte[] buf = new byte[1 << 16];
            long left = e.csize;
            while (left > 0) { int n = src.f.read(buf, 0, (int) Math.min(buf.length, left)); if (n <= 0) throw new EOFException(e.name); os.write(buf, 0, n); left -= n; }
            pos += e.csize;
        }

        void add(String name, byte[] data, boolean deflate) throws IOException {
            CRC32 crc = new CRC32(); crc.update(data);
            byte[] body = data; int method = 0;
            if (deflate) {
                Deflater d = new Deflater(6, true); d.setInput(data); d.finish();
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[1 << 16];
                while (!d.finished()) bo.write(buf, 0, d.deflate(buf));
                d.end(); body = bo.toByteArray(); method = 8;
            }
            header(name, 0x800, method, 0, 0x21, (int) crc.getValue(), body.length, data.length, 0, 0);
            os.write(body); pos += body.length;
        }

        @Override public void close() throws IOException {
            long cdOff = pos;
            byte[] c = cd.toByteArray();
            os.write(c); pos += c.length;
            if (pos >= 0xFFFFFFFFL || count >= 0xFFFF) throw new IOException("the result is larger than a zip32 archive can hold");
            u32(os, 0x06054b50L); u16(os, 0); u16(os, 0); u16(os, count); u16(os, count); u32(os, c.length); u32(os, cdOff); u16(os, 0);
            os.close();
        }
    }
}
