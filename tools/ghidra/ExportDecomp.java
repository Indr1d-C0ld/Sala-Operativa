// Esporta il C decompilato di tutte le funzioni in <arg0>.c
// Uso: ghidra-headless <proj> <nome> -import x.exe -postScript ExportDecomp.java out.c -scriptPath tools/ghidra
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class ExportDecomp extends GhidraScript {
    @Override
    public void run() throws Exception {
        String out = getScriptArgs().length > 0 ? getScriptArgs()[0] : "decomp.c";
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);
        int ok = 0, fail = 0;
        try (PrintWriter w = new PrintWriter(new FileWriter(out))) {
            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
            while (it.hasNext() && !monitor.isCancelled()) {
                Function f = it.next();
                DecompileResults r = ifc.decompileFunction(f, 60, monitor);
                w.println("// ===== " + f.getName() + " @ " + f.getEntryPoint());
                if (r != null && r.decompileCompleted()) {
                    w.println(r.getDecompiledFunction().getC());
                    ok++;
                } else {
                    w.println("// decompilazione fallita: " + (r == null ? "null" : r.getErrorMessage()));
                    fail++;
                }
            }
        }
        println("ExportDecomp: " + ok + " ok, " + fail + " fallite -> " + out);
    }
}
