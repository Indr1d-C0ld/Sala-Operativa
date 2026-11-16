#!/usr/bin/env python3
"""Pseudo-lifter per il codice MS C 6 (modello large, x87) di SHADOW.EXE.

Legge l'output di tools/sp_disasm.py e ricostruisce espressioni dallo stack x87:
  - indicizzazione dei record: mov ax,STRIDE / imul [bp-X] / mov bx,[bp-P] -> P[X] (stride)
  - helper runtime: 289f:2e8 = confronto st0 ? st1 (pop 2), 289f:2d4 = ftol
  - salti condizionati dopo un confronto -> "if (a < b) goto L"
Le istruzioni intere non riconosciute restano come commento "; asm".

Uso: python3 -I tools/sp_disasm.py A ab78 0ced | python3 -I tools/sp_lift.py > out.txt
"""
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIG = (ROOT / "re/orig/SHADOW/SHADOW.EXE").read_bytes()
DG = 21504 + 0x2F15 * 16

STRUCTS = {0xCA: "C", 0x3D: "N", 0x42: "CIA", 0x1F: "MN", 0xA0: "STRAT", 0xB4: "ASSET", 0x79: "AX", 0xD2: "REG", 0x19: "TR", 0xE: "CF"}
CF = {0: "nuclear_power", 8: "military_power", 16: "economic_power", 24: "reg_infl", 32: "total_infl",
      40: "total_infl_prev", 48: "reg_mil_share", 56: "military_share", 64: "mil_share_delta", 68: "nuclear_share",
      76: "nuc_share_delta", 80: "reg_econ_share", 88: "economic_share", 96: "nuclear_spending", 104: "milcap",
      112: "military_spending", 120: "pc_gnp", 128: "oil_reserves", 136: "strat_reserves", 144: "b144",
      145: "peace", 153: "bellig_avg3", 157: "bellig", 161: "bellig1", 165: "bellig2", 169: "LER",
      177: "qol", 185: "qol_prev", 193: "nuclear_level", 195: "ideology", 197: "alliance", 198: "stratval"}
NF = {0x00: "n00", 0x10: "n10", 0x18: "population", 0x24: "pop_growth", 0x28: "gdp_growth", 0x30: "ethic", 0x35: "ambition"}
# struttura di lavoro delle ansie (FUN_7714_10b4, 0x79 byte per paese, copiata da COUNTRY/NUMBERS/STRATEGY)
AXF = {0x00: "nuc_share", 0x08: "nuc_spend", 0x10: "mil_share", 0x18: "mil_spend", 0x20: "infl", 0x28: "econ_share",
       0x30: "pc_gnp", 0x38: "econ", 0x40: "ethic_i", 0x41: "gdp_growth", 0x45: "ideology", 0x46: "n00", 0x4e: "pop_i",
       0x52: "team", 0x53: "spy_budget", 0x5b: "ambition", 0x5f: "nuc_level", 0x61: "peace", 0x69: "x69",
       0x6d: "LER", 0x75: "pop_growth"}
SF = {0x00: "anx_nuclear", 0x08: "anx_military", 0x10: "anx_political", 0x18: "anx_economic", 0x20: "anx_social",
      0x28: "intel_budget", 0x30: "caag", 0x38: "intel_aid", 0x40: "insurg", 0x48: "esp_self", 0x50: "esp_foreign", 0x58: "mil_aid", 0x60: "econ_aid", 0x68: "hum_aid", 0x70: "nuc_aid", 0x78: "want_hum", 0x80: "want_econ", 0x88: "want_intel", 0x90: "want_mil", 0x98: "want_nuc"}
CIAF = {0: "area", 4: "population", 8: "pop_growth10", 15: "literacy", 16: "labor", 20: "gnp1e5", 24: "unemp",
        25: "revenues1e5", 29: "expend1e5", 33: "exports1e5", 37: "imports1e5", 41: "debt1e5", 45: "elec_kw",
        49: "fx", 53: "troops", 57: "u57", 59: "u59", 60: "gnp_growth", 64: "code64", 65: "code65"}


def const(addr, size):
    try:
        return repr(struct.unpack_from("<d" if size == "qword" else "<f", ORIG, DG + addr)[0])
    except struct.error:
        return f"g[{addr:#x}]"


class Lifter:
    def __init__(self):
        self.st = []
        self.stride = None
        self.idx = None
        self.base = {}      # registro -> nome base
        self.es_global = None
        self.cmp = None
        self.out = []
        self.ax = None       # valore costante noto di AX
        self.lconst = {}     # locale -> costante intera nota

    def mem(self, op, size):
        """Nome simbolico di un operando di memoria."""
        m = re.match(r"(?:(\w+):)?\[(.*)\]", op)
        if not m:
            return op
        seg, inner = m.group(1), m.group(2).replace(" ", "")
        if seg is None and re.fullmatch(r"0x[0-9a-f]+", inner):
            return const(int(inner, 16), size)
        mm = re.fullmatch(r"bp-(0x[0-9a-f]+|\d+)", inner)
        if mm:
            return f"L{int(mm.group(1), 0):x}"
        mm = re.fullmatch(r"bp\+(0x[0-9a-f]+|\d+)", inner)
        if mm:
            return f"ARG{int(mm.group(1), 0):x}"
        mm = re.fullmatch(r"(bx|si|di)(?:\+(0x[0-9a-f]+|\d+))?", inner)
        if mm and seg == "es":
            reg, off = mm.group(1), int(mm.group(2) or "0", 0)
            b = self.base.get(reg)
            if b and b[0] == "rec":
                kind, idx = b[1], b[2]
                names = {"C": CF, "N": NF, "CIA": CIAF, "AX": AXF, "STRAT": SF}.get(kind, {})
                return f"{kind}[{idx}].{names.get(off, f'+{off}')}"
            if b and b[0] == "glob":
                return f"{b[1]}->+{off:#x}"
            return f"es:[{reg}+{off:#x}]"
        if seg == "es" and re.fullmatch(r"0x[0-9a-f]+", inner):
            return f"{self.es_global or 'ES'}:{inner}"
        return f"{seg + ':' if seg else ''}[{inner}]"

    def emit(self, addr, s):
        self.out.append(f"{addr}  {s}")

    def step(self, addr, ins):
        op, _, rest = ins.partition(" ")
        args = [a.strip() for a in re.split(r",(?![^\[]*\])", rest)] if rest else []
        size = "qword" if "qword" in rest else "dword" if "dword" in rest else "word"
        clean = [re.sub(r"^(qword|dword|word|byte)\s+", "", a) for a in args]
        st = self.st

        # --- indicizzazione record ---
        if op == "mov" and clean[0] == "ax" and re.fullmatch(r"0x[0-9a-f]+|\d+", clean[1] or ""):
            v = int(clean[1], 0)
            self.stride = v if v in STRUCTS else None
            self.ax = v - 0x10000 if v >= 0x8000 else v   # interi a 16 bit con segno
            return
        if op in ("cdq", "cwd"):
            return
        if op == "mov" and clean[0] == "ax" and re.fullmatch(r"\[bp ?[-+].*\]", clean[1] or ""):
            self.ax = self.mem(clean[1], "word")   # nome simbolico di una locale intera
            return
        if op == "imul" and self.stride and clean and clean[0].startswith("[bp"):
            self.idx = self.mem(clean[0], "word")
            return
        if op == "imul" and self.ax is not None and len(clean) == 1 and clean[0].startswith("[bp"):
            self.ax = f"({self.ax} * {self.mem(clean[0], 'word')})"   # costante * locale intera
            return
        if op == "mov" and clean[0] in ("bx", "si", "di") and clean[1].startswith("[bp") and self.idx and self.stride:
            self.base[clean[0]] = ("rec", STRUCTS[self.stride], self.idx)
            return
        if op == "mov" and clean[0] == "cx" and clean[1].startswith("[bp"):
            return
        if op == "add" and clean[0] in ("bx", "si", "di") and clean[1] == "ax" and self.idx:
            self.idx = None
            return
        if op == "mov" and clean[0] == "es":
            m = re.fullmatch(r"\[(0x[0-9a-f]+)\]", clean[1])
            if m:   # la variabile di DGROUP contiene il segmento: lo risolviamo dall'EXE originale
                segv = struct.unpack_from("<H", ORIG, DG + int(m.group(1), 16))[0]
                self.es_global = f"{segv:04x}"
            else:
                self.es_global = None
            return
        if op == "les" and clean[0] in ("bx", "si", "di"):
            self.base[clean[0]] = ("glob", f"*{self.es_global}:{clean[1].split('[')[-1].rstrip(']')}")
            return
        if op in ("wait", "nop"):
            return

        # --- x87 ---
        if op == "fild" and clean and clean[0].startswith("[bp") and self.mem(clean[0], size) in self.lconst:
            st.append(str(self.lconst[self.mem(clean[0], size)]))
            return
        if op in ("fld", "fild"):
            if clean and clean[0].startswith("st("):
                st.append(st[-1 - int(clean[0][3])] if len(st) > int(clean[0][3]) else "?")
            else:
                st.append(self.mem(args[0].split(" ", 1)[-1] if " " in args[0] else args[0], size)
                          if not clean[0].startswith("[") and ":" not in clean[0] else self.mem(clean[0], size))
            return
        if op == "fldz":
            st.append("0"); return
        if op == "fld1":
            st.append("1"); return
        if op in ("fstp", "fst", "fistp", "fist"):
            v = st[-1] if st else "?"
            if clean and clean[0].startswith("st("):
                k = int(clean[0][3])
                if len(st) > k:
                    st[-1 - k] = v
            else:
                self.emit(addr, f"{self.mem(clean[0], size)} = {v}")
            if op.endswith("p") and st:
                st.pop()
            return
        if op in ("fadd", "fsub", "fmul", "fdiv", "fsubr", "fdivr", "fiadd", "fimul", "fidiv", "fisub"):
            sym = {"add": "+", "sub": "-", "mul": "*", "div": "/"}[op[-3:] if op[-1] != "r" else op[-4:-1]]
            if len(clean) == 1 and not clean[0].startswith("st"):
                b = self.mem(clean[0], size)
                a = st.pop() if st else "?"
                st.append(f"({b} {sym} {a})" if op.endswith("r") else f"({a} {sym} {b})")
                return
            if len(clean) == 2 and len(st) >= 2:  # fxxx st(0), st(i)
                k = int(clean[1][3]) if clean[1].startswith("st(") else 0
                a, b = st[-1], st[-1 - k]
                st[-1] = f"({b} {sym} {a})" if op.endswith("r") else f"({a} {sym} {b})"
                return
        if op in ("faddp", "fsubp", "fmulp", "fdivp", "fsubrp", "fdivrp"):
            if len(st) >= 2:
                a = st.pop(); b = st.pop()
                sym = {"add": "+", "sub": "-", "mul": "*", "div": "/"}[op[1:4]]
                # sintassi r2/Intel: fsubp st(1) => st1 = st1 - st0 ; fsubrp => st0 - st1
                st.append(f"({a} {sym} {b})" if op in ("fsubrp", "fdivrp") else f"({b} {sym} {a})")
            return
        if op == "fxch":
            if len(st) >= 2:
                k = int(clean[0][3]) if clean else 1
                st[-1], st[-1 - k] = st[-1 - k], st[-1]
            return
        if op == "fchs":
            if st: st[-1] = f"-{st[-1]}"
            return
        if op == "fabs":
            if st: st[-1] = f"abs({st[-1]})"
            return
        if op in ("fsqrt",):
            if st: st[-1] = f"sqrt({st[-1]})"
            return
        if op == "lcall":
            tgt = clean[0]
            if tgt == "0x289f:0x2e8":   # confronto st0 ? st1, pop 2
                a = st.pop() if st else "?"; b = st.pop() if st else "?"
                self.cmp = (a, b)
                return
            if tgt == "0x289f:0x2d4":   # ftol
                a = st.pop() if st else "?"
                self.emit(addr, f"ax = int({a})")
                self.ax = None
                return
            self.emit(addr, f"call {tgt}   ; fpu_stack={st}")
            return
        if op.startswith("j") and self.cmp and op != "jmp":
            rel = {"jb": "<", "jae": ">=", "ja": ">", "jbe": "<=", "je": "==", "jne": "!="}.get(op, op)
            self.emit(addr, f"if ({self.cmp[0]} {rel} {self.cmp[1]}) goto {clean[0]}")
            self.cmp = None
            return
        if op == "mov" and clean[0].startswith("[bp") and clean[1] == "ax":
            name = self.mem(clean[0], 'word')
            if self.ax is not None:
                self.lconst[name] = self.ax
                if isinstance(self.ax, str):
                    self.emit(addr, f"{name} = {self.ax}") if not name.startswith(("L1f", "L1fe", "L20")) else None
            else:
                self.lconst.pop(name, None)
                self.emit(addr, f"{name} = ax")
            return
        if op == "mov" and clean[0].startswith("[bp") and clean[1] == "dx":
            return
        if op == "mov" and clean[0].startswith("[bp") and re.fullmatch(r"0x[0-9a-f]+|\d+", clean[1]):
            v = int(clean[1], 0)
            self.emit(addr, f"{self.mem(clean[0], 'word')} = {v - 0x10000 if v >= 0x8000 else v}")
            return
        if op == "add" and clean[0].startswith("[bp") and clean[1] == "1":
            self.emit(addr, f"{self.mem(clean[0], 'word')} += 1")
            return
        if op == "cmp" and clean[0].startswith("[bp"):
            self.emit(addr, f"cmp {self.mem(clean[0], 'word')}, {clean[1]}")
            return
        if clean and clean[0] in ("ax", "al", "eax"):
            self.ax = None
        self.emit(addr, f"; asm {ins}")


def main():
    lf = Lifter()
    for line in sys.stdin:
        line = re.sub(r"^[\s│╎┌└─<>┐┘├]+", "", line.rstrip())
        line = line.split("    ;")[0]
        m = re.match(r"([0-9a-f]{4})\s+(.*)", line)
        if not m:
            continue
        addr, ins = m.groups()
        if ins.startswith("invalid"):
            continue
        lf.step(addr, ins.strip())
    print("\n".join(lf.out))


if __name__ == "__main__":
    main()
