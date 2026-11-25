package team.ccb.kmod_launcher.installer;

import com.android.tools.smali.dexlib2.AccessFlags;
import com.android.tools.smali.dexlib2.DexFileFactory;
import com.android.tools.smali.dexlib2.Opcode;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.iface.ClassDef;
import com.android.tools.smali.dexlib2.iface.DexFile;
import com.android.tools.smali.dexlib2.iface.Method;
import com.android.tools.smali.dexlib2.iface.MethodImplementation;
import com.android.tools.smali.dexlib2.iface.MethodParameter;
import com.android.tools.smali.dexlib2.iface.instruction.Instruction;
import com.android.tools.smali.dexlib2.immutable.ImmutableClassDef;
import com.android.tools.smali.dexlib2.immutable.ImmutableMethod;
import com.android.tools.smali.dexlib2.immutable.ImmutableMethodImplementation;
import com.android.tools.smali.dexlib2.immutable.instruction.ImmutableInstruction;
import com.android.tools.smali.dexlib2.immutable.instruction.ImmutableInstruction10x;
import com.android.tools.smali.dexlib2.immutable.instruction.ImmutableInstruction21c;
import com.android.tools.smali.dexlib2.immutable.instruction.ImmutableInstruction35c;
import com.android.tools.smali.dexlib2.immutable.reference.ImmutableMethodReference;
import com.android.tools.smali.dexlib2.immutable.reference.ImmutableStringReference;
import com.android.tools.smali.dexlib2.writer.io.FileDataStore;
import com.android.tools.smali.dexlib2.writer.pool.DexPool;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Makes the static initializer of `classDesc` call System.loadLibrary(lib) first (same patch as tools/DexTool.java). */
final class DexPatch {
    static void patch(File in, File out, String classDesc, String lib) throws Exception {
        DexFile dex = DexFileFactory.loadDexFile(in, Opcodes.forApi(35));
        DexPool pool = new DexPool(Opcodes.forApi(28));
        boolean done = false;
        for (ClassDef c : dex.getClasses()) {
            if (!c.getType().equals(classDesc)) { pool.internClass(c); continue; }
            List<Method> ms = new ArrayList<>();
            boolean hadClinit = false;
            for (Method m : c.getMethods()) {
                if (!m.getName().equals("<clinit>")) { ms.add(m); continue; }
                hadClinit = true;
                MethodImplementation impl = m.getImplementation();
                if (impl == null) throw new IllegalStateException("<clinit> has no code");
                if (!impl.getTryBlocks().isEmpty()) throw new IllegalStateException("<clinit> of " + classDesc + " has try blocks: cannot patch it");
                List<Instruction> ins = new ArrayList<>(loadLibrary(lib));
                for (Instruction i : impl.getInstructions()) ins.add(ImmutableInstruction.of(i));
                ImmutableMethodImplementation ni = new ImmutableMethodImplementation(Math.max(impl.getRegisterCount(), 1), ins, null, null);
                ms.add(new ImmutableMethod(m.getDefiningClass(), m.getName(), m.getParameters(), m.getReturnType(), m.getAccessFlags(),
                        m.getAnnotations(), m.getHiddenApiRestrictions(), ni));
            }
            if (!hadClinit) {
                List<Instruction> ins = new ArrayList<>(loadLibrary(lib));
                ins.add(new ImmutableInstruction10x(Opcode.RETURN_VOID));
                ImmutableMethodImplementation ni = new ImmutableMethodImplementation(1, ins, null, null);
                ms.add(new ImmutableMethod(c.getType(), "<clinit>", Collections.<MethodParameter>emptyList(), "V",
                        AccessFlags.STATIC.getValue() | AccessFlags.CONSTRUCTOR.getValue(), null, null, ni));
            }
            pool.internClass(new ImmutableClassDef(c.getType(), c.getAccessFlags(), c.getSuperclass(), c.getInterfaces(),
                    c.getSourceFile(), c.getAnnotations(), c.getFields(), ms));
            done = true;
        }
        if (!done) throw new IllegalStateException("class not found: " + classDesc);
        pool.writeTo(new FileDataStore(out));
    }

    private static List<Instruction> loadLibrary(String lib) {
        List<Instruction> ins = new ArrayList<>();
        ins.add(new ImmutableInstruction21c(Opcode.CONST_STRING, 0, new ImmutableStringReference(lib)));
        ins.add(new ImmutableInstruction35c(Opcode.INVOKE_STATIC, 1, 0, 0, 0, 0, 0,
                new ImmutableMethodReference("Ljava/lang/System;", "loadLibrary", Arrays.asList("Ljava/lang/String;"), "V")));
        return ins;
    }
}
