#!/bin/bash
# ResearchOne Redis Setup Script
# Run on truvector-redis (10.0.101.3)
# Prerequisites: Redis already installed

set -e

REDIS_PASSWORD="${REDIS_PASSWORD:-}"
PRIVATE_IP="10.0.101.3"

echo "=== ResearchOne Redis Setup ==="

REDIS_CONF="/etc/redis/redis.conf"

# Configure Redis to bind to private interface
sudo sed -i "s/^bind 127.0.0.1.*/bind 127.0.0.1 ${PRIVATE_IP}/" "${REDIS_CONF}"

# Set max memory policy for queue workload
sudo tee -a "${REDIS_CONF}" > /dev/null <<EOF

# ResearchOne configuration
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
EOF

if [ -n "${REDIS_PASSWORD}" ]; then
  echo "requirepass ${REDIS_PASSWORD}" | sudo tee -a "${REDIS_CONF}"
  echo "Redis password set."
fi

sudo systemctl restart redis

echo "=== Redis configured ==="
echo "Testing connection from private network..."
redis-cli -h "${PRIVATE_IP}" ping

echo "=== Redis setup complete ==="
