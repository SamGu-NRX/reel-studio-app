"""Resolve conflict blocks whose two sides are only ES `import` lines: one import per module, with the union of
the names both sides import from it, in the order they first appear. Any other conflict block is left as is.

    python3 scripts/alpha/union-imports.py FILE...

Prints each file whose conflicts are now all resolved. Exits 0 when every file given is resolved, else 1.
"""
import re
import sys

BLOCK = re.compile(r"<<<<<<< [^\n]*\n(.*?)(?:\|\|\|\|\|\|\| [^\n]*\n.*?)?=======\n(.*?)>>>>>>> [^\n]*\n", re.S)
NAMED = re.compile(r"^import (type )?\{ ([^}]*) \} from '([^']+)'$")
OTHER = re.compile(r"^import .+ from '([^']+)'$")


def union(ours: str, theirs: str):
    order, named, other = [], {}, {}
    for line in (ours + theirs).splitlines():
        if not line.strip():
            continue
        m = NAMED.match(line)
        if m:
            key = (m.group(1) or "", m.group(3))
            if key not in named:
                named[key] = []
                order.append(("named", key))
            for name in (n.strip() for n in m.group(2).split(",")):
                if name and name not in named[key]:
                    named[key].append(name)
            continue
        if OTHER.match(line):
            if line not in other:
                other[line] = True
                order.append(("other", line))
            continue
        return None
    out = []
    for kind, key in order:
        if kind == "other":
            out.append(key)
        else:
            out.append(f"import {key[0]}{{ {', '.join(named[key])} }} from '{key[1]}'")
    return "\n".join(out) + "\n"


def main() -> int:
    all_done = True
    for path in sys.argv[1:]:
        text = open(path).read()
        result = BLOCK.sub(lambda m: union(m.group(1), m.group(2)) or m.group(0), text)
        if result != text:
            open(path, "w").write(result)
        if "<<<<<<< " in result:
            all_done = False
        else:
            print(path)
    return 0 if all_done else 1


if __name__ == "__main__":
    sys.exit(main())
