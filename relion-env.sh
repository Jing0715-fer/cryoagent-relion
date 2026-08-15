#!/bin/bash
# Source this to enable the user-space RELION 3.1.3 + ctffind install.
RELION_PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/relion-pkg"
export PATH="$RELION_PKG_DIR/usr/bin:$PATH"
export LD_LIBRARY_PATH="$RELION_PKG_DIR/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
export RELION_CTFFIND_EXECUTABLE="$RELION_PKG_DIR/usr/bin/ctffind"
export OMP_NUM_THREADS=2
