# PostgreSQL deployment on CentOS (for this project)

This backend now supports two DB modes:

- `DB_CLIENT=sqljs` (default, local file database)
- `DB_CLIENT=postgres` (PostgreSQL)

## Quick env templates

- Local development template: `server/.env.local.example`
- Production template: `server/.env.prod.example`

Common usage:

```bash
# local
cp .env.local.example .env

# production
cp .env.prod.example .env
```

## 1) Install PostgreSQL on CentOS

Example for CentOS Stream / RHEL-compatible systems:

```bash
sudo dnf -y install postgresql-server postgresql-contrib
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

Create database/user:

```bash
sudo -u postgres psql -c "CREATE USER tongxing WITH PASSWORD 'replace-me-strong';"
sudo -u postgres psql -c "CREATE DATABASE tongxing OWNER tongxing;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE tongxing TO tongxing;"
```

## 2) Install build dependencies for `pg-native`

`pg-native` is an optional dependency used when `DB_CLIENT=postgres`.

```bash
sudo dnf -y install postgresql-devel gcc-c++ make python3
```

## 3) Configure environment

In `server/.env`:

```env
DB_CLIENT=postgres
DATABASE_URL=postgres://tongxing:replace-me-strong@127.0.0.1:5432/tongxing
```

Or use PG split fields:

```env
DB_CLIENT=postgres
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=tongxing
PGPASSWORD=replace-me-strong
PGDATABASE=tongxing
PGSSLMODE=disable
```

## 4) Install node dependencies and start

```bash
cd server
npm install
npm run check
npm run dev
```

`initSchema()` will automatically apply `sql/schema-postgres.sql` at startup.
