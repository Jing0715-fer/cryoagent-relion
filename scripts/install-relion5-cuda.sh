#!/bin/bash
# Build RELION 5.0 with CUDA on WSL2 Debian 11 bullseye.
# Targets sm_75 (Turing — GTX 16-series). Adjust CUDA_ARCH for other GPUs.
set -e

CUDA_ARCH="${1:-sm_75}"

if [ ! -d "/home/z/src/relion5-src-stable" ]; then
    mkdir -p /home/z/src
    cd /home/z/src
    curl -sL https://github.com/3dem/relion/archive/refs/tags/5.0.1.tar.gz | tar xz
    mv relion-5.0.1 relion5-src-stable
fi

BUILD_DIR="/home/z/myproject/relion5-build-cuda-fixed"
SRC_DIR="/home/z/src/relion5-src-stable"
INSTALL_DIR="/home/z/my-project/relion5-pkg"

export PATH="/root/.local/bin:$PATH"
export CUDA_HOME=/usr

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
rm -rf ./*

# Patch MPI stubs and disable MPI
# (already done in source: find_package(MPI REQUIRED) -> find_package(MPI))
# Patch: MPI stub include path

cmake "$SRC_DIR" \
    -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCUDA=ON \
    -DCUDA_ARCH="$CUDA_ARCH" \
    -DGUI=OFF \
    -DMPI=OFF \
    -DFETCH_WEIGHTS=OFF \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    "-DCMAKE_CXX_FLAGS=-O2 -I/home/z/my-project/mini-services/relion-runner/mpi-stub -fopenmp" \
    "-DCMAKE_C_FLAGS=-O2 -I/home/z/my-project/mini-services/relion-runner/mpi-stub -fopenmp"

echo "[$(date)] cmake done. Compiling (10-15 min)..."
make -j2
echo "[$(date)] make done. Installing..."
make install
echo "[$(date)] install done."
"$INSTALL_DIR/bin/relion_refine" --version | head -3
echo "[$(date)] SUCCESS."