// Crea funzioni agli ingressi raggiunti solo tramite gli stub degli overlay e ne esporta il C.
// Uso: -postScript StubFuncs.java <targets.txt> <out.c>   (targets: righe "seg:off" esadecimali)
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class StubFuncs extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] a = getScriptArgs();
        List<Function> made = new ArrayList<>();
        for (String line : Files.readAllLines(Paths.get(a[0]))) {
            line = line.trim();
            if (line.isEmpty()) continue;
            String[] p = line.split(":");
            long lin = Long.parseLong(p[0], 16) * 16 + Long.parseLong(p[1], 16);
            Address ad = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(lin);
            Function f = getFunctionAt(ad);
            if (f != null) continue;
            if (getInstructionAt(ad) == null) {
                clearListing(ad);
                new DisassembleCommand(ad, null, true).applyTo(currentProgram, monitor);
            }
            f = createFunction(ad, "FUN_" + p[0] + "_" + p[1]);
            if (f == null) f = getFunctionAt(ad);
            if (f != null) made.add(f);
            else println("non creata: " + line);
        }
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);
        int ok = 0;
        try (PrintWriter w = new PrintWriter(new FileWriter(a[1]))) {
            for (Function f : made) {
                DecompileResults r = ifc.decompileFunction(f, 120, monitor);
                w.println("// ===== " + f.getName() + " @ " + f.getEntryPoint());
                if (r != null && r.decompileCompleted()) { w.println(r.getDecompiledFunction().getC()); ok++; }
                else w.println("// decompilazione fallita: " + (r == null ? "null" : r.getErrorMessage()));
            }
        }
        println("StubFuncs: " + made.size() + " create, " + ok + " decompilate -> " + a[1]);
    }
}
