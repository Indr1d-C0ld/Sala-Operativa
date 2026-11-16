// Pre-script: imposta DS = DGROUP su tutta la memoria, così Ghidra risolve le
// variabili globali (Microsoft C, modello large: DS fisso su DGROUP).
// Uso: -preScript SetDS.java 3F15
import ghidra.app.script.GhidraScript;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.ProgramContext;
import ghidra.program.model.mem.MemoryBlock;
import java.math.BigInteger;

public class SetDS extends GhidraScript {
    @Override
    public void run() throws Exception {
        String a = getScriptArgs().length > 0 ? getScriptArgs()[0] : "3F15";
        BigInteger ds = new BigInteger(a, 16);
        ProgramContext ctx = currentProgram.getProgramContext();
        Register reg = ctx.getRegister("DS");
        for (MemoryBlock b : currentProgram.getMemory().getBlocks()) {
            if (b.isInitialized()) {
                ctx.setValue(reg, b.getStart(), b.getEnd(), ds);
            }
        }
        println("SetDS: DS=" + a + " su " + currentProgram.getMemory().getBlocks().length + " blocchi");
    }
}
