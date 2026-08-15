#!/bin/bash
# RELION 5.0 one-click installer for the CryoAgent sandbox.
# Builds RELION 5.0 from source (CPU-only, no CUDA needed).
#
# Usage: bash scripts/install-relion5.sh
#
# Prerequisites: cmake, gcc, g++, make (all pre-installed or via pip install cmake)

set -e

echo "=== RELION 5.0 Installer ==="

RELION_VERSION="5.0.1"
INSTALL_DIR="/home/z/my-project/relion5-pkg"
BUILD_DIR="/tmp/relion5-build"
SRC_DIR="/tmp/relion5-src"

# Check if already installed
if [ -f "$INSTALL_DIR/bin/relion_refine" ]; then
    echo "✅ RELION 5.0 already installed at $INSTALL_DIR"
    echo "   Version: $("$INSTALL_DIR/bin/relion_refine" --version 2>&1 || echo 'unknown')"
    exit 0
fi

# Install cmake if not available
if ! command -v cmake &>/dev/null; then
    echo "📦 Installing cmake..."
    pip install --user --break-system-packages cmake 2>&1 | tail -2
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "📥 Downloading RELION $RELION_VERSION source..."
rm -rf "$SRC_DIR" "$BUILD_DIR"
mkdir -p "$SRC_DIR" "$BUILD_DIR"

# Download from GitHub
curl -sL "https://github.com/3dem/relion/archive/refs/tags/$RELION_VERSION.tar.gz" -o /tmp/relion5.tar.gz
tar xzf /tmp/relion5.tar.gz -C "$SRC_DIR" --strip-components=1

# Patch: make MPI optional (RELION 5.0 hard-codes REQUIRED, but we don't need MPI)
echo "🔧 Patching CMakeLists.txt to make MPI optional..."
sed -i 's/find_package(MPI REQUIRED)/find_package(MPI OPTIONAL)/' "$SRC_DIR/CMakeLists.txt"
sed -i 's/include_directories("${MPI_CXX_INCLUDE_DIRS}")/# include_directories("${MPI_CXX_INCLUDE_DIRS}")/' "$SRC_DIR/CMakeLists.txt"
sed -i 's/include_directories("${MPI_CXX_INCLUDE_PATH}")/# include_directories("${MPI_CXX_INCLUDE_PATH}")/' "$SRC_DIR/CMakeLists.txt"
# Also comment out the hard-coded MPI compiler settings (lines 359-360)
# so CMake uses the default g++/gcc instead of mpicxx/mpicc
sed -i 's/^SET(CMAKE_C_COMPILER ${MPI_C_COMPILER})/# SET(CMAKE_C_COMPILER ${MPI_C_COMPILER})/' "$SRC_DIR/CMakeLists.txt"
sed -i 's/^SET(CMAKE_CXX_COMPILER ${MPI_CXX_COMPILER})/# SET(CMAKE_CXX_COMPILER ${MPI_CXX_COMPILER})/' "$SRC_DIR/CMakeLists.txt"
# Also remove the -DUSE_MPI_COLLECTIVE definition
sed -i 's/-DUSE_MPI_COLLECTIVE//' "$SRC_DIR/CMakeLists.txt"
sed -i 's/-DUSE_MPI_COLLECTIVE//' "$SRC_DIR/src/apps/CMakeLists.txt" 2>/dev/null || true
echo "   Source downloaded to $SRC_DIR"

echo "🔨 Building RELION 5.0 (CPU-only, no CUDA)..."
cd "$BUILD_DIR"

# Configure with cmake — CPU-only, no CUDA, no GUI
cmake "$SRC_DIR" \
    -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCUDA=OFF \
    -DGUI=OFF \
    -DMPI=OFF \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DCMAKE_CXX_FLAGS="-O2 -I/home/z/my-project/mini-services/relion-runner/mpi-stub" \
    -DCMAKE_C_FLAGS="-O2 -I/home/z/my-project/mini-services/relion-runner/mpi-stub" \
    2>&1 | tail -10

# Build with 2 threads (limited CPU)
echo "🔨 Compiling (this may take 5-10 minutes)..."
make -j2 2>&1 | tail -20

echo "📦 Installing to $INSTALL_DIR..."
make install 2>&1 | tail -5

# Verify installation
if [ -f "$INSTALL_DIR/bin/relion_refine" ]; then
    echo "✅ RELION 5.0 installed successfully!"
    echo "   Location: $INSTALL_DIR/bin/"
    echo "   Binaries:"
    ls "$INSTALL_DIR/bin/" | head -10
    echo "   Version: $("$INSTALL_DIR/bin/relion_refine" --version 2>&1 || echo 'check manually')"
else
    echo "❌ Installation failed — relion_refine not found"
    exit 1
fi

# Clean up build artifacts
rm -rf "$BUILD_DIR" "$SRC_DIR" /tmp/relion5.tar.gz
echo "🧹 Cleaned up build artifacts"
echo ""
echo "=== Installation complete ==="
echo "To use RELION 5.0, add to PATH:"
echo "  export PATH=\"$INSTALL_DIR/bin:\$PATH\""
# Note: RELION 5.0 hard-codes find_package(MPI REQUIRED). We patch it to make
# MPI optional (build without MPI for single-node CPU execution).
