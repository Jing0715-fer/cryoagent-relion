#!/bin/bash
# Launch script for the relion-runner mini-service.
# Sources the RELION env (user-space binaries + libs) then runs the python server.
cd "$(dirname "$0")"
source /home/z/my-project/relion-env.sh
exec python3 server.py
