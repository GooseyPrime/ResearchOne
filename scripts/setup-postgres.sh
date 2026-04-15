#!/bin/bash
# ResearchOne PostgreSQL Setup Script
# Run on truvector-postgres (10.0.101.2)
# Prerequisites: PostgreSQL already installed

set -e

DB_NAME="researchone"
DB_USER="researchone"
DB_PASSWORD="${DB_PASSWORD:-changeme_in_production}"

echo "=== ResearchOne PostgreSQL Setup ==="

# Create user and database
sudo -u postgres psql <<-SQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
    END IF;
  END \$\$;

  CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
  GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

# Install pgvector extension (required for vector search)
echo "Installing pgvector..."
sudo apt-get update -qq
sudo apt-get install -y postgresql-server-dev-$(pg_config --version | grep -oP '\d+' | head -1) build-essential git

if [ ! -d /tmp/pgvector ]; then
  git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git /tmp/pgvector
fi

cd /tmp/pgvector
make
sudo make install

# Enable extensions
sudo -u postgres psql -d "${DB_NAME}" <<-SQL
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "vector";
  CREATE EXTENSION IF NOT EXISTS "pg_trgm";
SQL

echo "=== PostgreSQL setup complete ==="
echo "Connection string: postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

# Configure pg_hba.conf to allow connections from private network
echo "Updating pg_hba.conf for private network access..."
PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file;" | tr -d ' ')
echo "host    ${DB_NAME}    ${DB_USER}    10.0.101.0/24    md5" | sudo tee -a "${PG_HBA}"

# Configure postgresql.conf to listen on private interface
PG_CONF=$(sudo -u postgres psql -t -c "SHOW config_file;" | tr -d ' ')
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '10.0.101.2,127.0.0.1'/" "${PG_CONF}"

sudo systemctl reload postgresql

echo "=== PostgreSQL configured for private network ==="
