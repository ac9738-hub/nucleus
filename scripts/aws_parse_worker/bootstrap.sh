#!/bin/bash
# EC2 first-boot bootstrap for Nucleus parse worker (Ubuntu 22.04).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y \
  python3 python3-pip python3-venv git \
  poppler-utils \
  build-essential libjpeg-dev zlib1g-dev

mkdir -p /home/ubuntu/nucleus
chown -R ubuntu:ubuntu /home/ubuntu/nucleus

# Marker for provision script to detect readiness.
touch /var/lib/nucleus-worker-ready
echo "nucleus worker bootstrap complete"
