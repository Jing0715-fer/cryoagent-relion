#!/bin/bash
# Source this to enable the user-space RELION install.
# RELION 5.0.1 (built from source) takes priority over RELION 3.1.0 debs.
# ctffind 4.1.14 needs GLIBC 2.38 (Debian 13 trixie); WSL bullseye is 2.31,
# so we use a local ctffind stub that returns synthetic default-defocus CTF
# values (server.py's backfill path consumes them).
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELION5_PKG="$PROJECT_ROOT/relion5-pkg"
RELION3_PKG="$PROJECT_ROOT/relion-pkg"

# RELION 5.0 first, RELION 3.0 fallback
export PATH="$RELION5_PKG/bin:$RELION3_PKG/usr/bin:$PATH"
if [[ -d "$RELION5_PKG/lib" ]]; then
    export LD_LIBRARY_PATH="$RELION5_PKG/lib:${LD_LIBRARY_PATH:-}"
fi
if [[ -d "$RELION3_PKG/usr/lib/x86_64-linux-gnu" ]]; then
    export LD_LIBRARY_PATH="$RELION3_PKG/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
fi
# ctffind stub (works around GLIBC 2.38 requirement on bullseye)
export RELION_CTFFIND_EXECUTABLE="$PROJECT_ROOT/mini-services/relion-runner/ctffind-stub.sh"
export OMP_NUM_THREADS=2
