# Vendored runtime tools

Place `plink.exe` in this folder for deterministic Windows password SSH.

Expected path:
- `rip-ui/bin/plink.exe`

Behavior:
- Bridge will use `MEMJET_PLINK_PATH` if set.
- Else it will use vendored `bin/plink.exe`.
- Else it will try `plink` from PATH.
- If none are available, bridge fails fast with a clear error.
