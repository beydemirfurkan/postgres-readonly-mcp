# PostgreSQL Read-Only MCP Server

A Model Context Protocol (MCP) server that provides safe, read-only access to PostgreSQL databases.

This server exposes database tools (list tables, describe schema, preview rows, run read-only queries, show relations, stats) to MCP clients such as Claude Desktop.

## What This Project Solves

When AI tools need database context, direct SQL access can be risky.
This server adds a controlled layer:

- Read-only query validation
- Tool-based access to schema and data
- Query result limits and timeout protection
- Multi-database support (`db` and `db2`)
- Sanitized error messages (credentials are redacted)

## Features

- Strict read-only access to PostgreSQL (`SELECT` only)
- Table and schema inspection
- Data preview with row and text truncation limits
- Foreign key relationship discovery
- Database-level statistics (size, row estimates, largest tables)
- Two logical database targets: `db` (primary) and `db2` (secondary)

## Project Structure

`src/index.ts` - MCP server entry point and tool registration  
`src/connection-manager.ts` - connection pooling, env parsing, query execution  
`src/query-validator.ts` - read-only validation rules  
`src/tools/*.ts` - tool implementations  

## Requirements

- Node.js 18+
- npm
- PostgreSQL network access from your machine

## Installation

```bash
git clone <repository-url>
cd postgres-readonly-mcp
npm install
npm run build
```

## Quick Start (Step by Step)

### 1) Configure Environment

Create a `.env` file in project root.

You can use one of these patterns.

#### Option A: Single URL for both `db` and `db2`

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public
```

#### Option B: Separate host fields (recommended for clarity)

```env
# Primary database (db)
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=your_database
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

# Secondary database (db2)
DB2_HOST=127.0.0.1
DB2_PORT=5432
DB2_USER=postgres
DB2_PASSWORD=your_password
DB2_NAME=your_database_2
DB2_SSL=true
DB2_SSL_REJECT_UNAUTHORIZED=true
```

#### Option C: Separate URLs

```env
DB_URL=postgresql://USER:PASSWORD@HOST:5432/DB1
DB2_URL=postgresql://USER:PASSWORD@HOST:5432/DB2
```

### 2) Build

```bash
npm run build
```

### 3) Run

```bash
npm start
```

For development mode:

```bash
npm run dev
```

### 4) Connect from Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "postgres-readonly": {
      "command": "node",
      "args": ["/absolute/path/to/postgres-readonly-mcp/dist/index.js"],
      "env": {
        "DB_HOST": "127.0.0.1",
        "DB_PORT": "5432",
        "DB_USER": "postgres",
        "DB_PASSWORD": "your_password",
        "DB_NAME": "your_database",
        "DB_SSL": "true",
        "DB_SSL_REJECT_UNAUTHORIZED": "true",
        "DB2_HOST": "127.0.0.1",
        "DB2_PORT": "5432",
        "DB2_USER": "postgres",
        "DB2_PASSWORD": "your_password",
        "DB2_NAME": "your_database_2",
        "DB2_SSL": "true",
        "DB2_SSL_REJECT_UNAUTHORIZED": "true"
      }
    }
  }
}
```

Restart Claude Desktop after editing config.

## Environment Variable Reference

### Core Variables

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` -> primary connection (`db`)
- `DB2_HOST`, `DB2_PORT`, `DB2_USER`, `DB2_PASSWORD`, `DB2_NAME` -> secondary connection (`db2`)
- `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` -> TLS settings for `db`
- `DB2_SSL`, `DB2_SSL_REJECT_UNAUTHORIZED` -> TLS settings for `db2`
- `DATABASE_URL` -> fallback URL for both databases
- `DB_URL`, `DB2_URL` -> explicit URL per database
- `DB_DATABASE_URL`, `DB2_DATABASE_URL` -> alias URL names also supported

`DB_SSL` defaults to `true` in strict mode.

### Resolution Priority

For `db`:

1. `DB_*` fields
2. `DB_URL` or `DB_DATABASE_URL`
3. `DATABASE_URL`
4. Defaults (`localhost`, `5432`, `postgres`, empty password, `postgres`)

For `db2`:

1. `DB2_*` fields
2. `DB2_URL` or `DB2_DATABASE_URL`
3. `DATABASE_URL`
4. Fallback to resolved `db` values

## URL Encoding Note

If your password includes special characters (`/`, `@`, `:`), URL encode it in connection strings.

Example:

- Real password: `my/pass`
- In URL: `my%2Fpass`

```env
DATABASE_URL=postgresql://postgres:my%2Fpass@127.0.0.1:5432/your_database?schema=public
```

## Tool Reference

All tools accept optional `database` with values:

- `db` (default)
- `db2`

### 1) `list_tables`

List tables/views in a schema.

Input:

```json
{
  "database": "db",
  "schema": "public"
}
```

Returns array of:

- `name`
- `type` (`BASE TABLE` or `VIEW`)
- `rowCount` (estimate)
- `schema`

### 2) `describe_table`

Describe columns, primary key, foreign keys, and indexes.

Input:

```json
{
  "database": "db",
  "schema": "public",
  "table": "Mail"
}
```

### 3) `preview_data`

Preview rows from a table with optional column selection.

Input:

```json
{
  "database": "db",
  "schema": "public",
  "table": "Mail",
  "columns": ["id", "subject", "createdAt"],
  "limit": 10
}
```

### 4) `run_query`

Run a custom read-only SQL query.

Input:

```json
{
  "database": "db",
  "query": "SELECT id, subject FROM \"public\".\"Mail\" ORDER BY id DESC",
  "limit": 100
}
```

### 5) `show_relations`

Show foreign key relations for a table (incoming and outgoing).

Input:

```json
{
  "database": "db",
  "schema": "public",
  "table": "Mail"
}
```

### 6) `db_stats`

Get database size and table statistics.

Input:

```json
{
  "database": "db"
}
```

Returns:

- `database`
- `totalTables`
- `totalRows`
- `totalSize`
- `largestTables`

## Read-Only and Safety Rules

### Allowed statement types

- `SELECT`

### Blocked keywords (examples)

- `INSERT`, `UPDATE`, `DELETE`
- `DROP`, `ALTER`, `TRUNCATE`, `CREATE`
- `GRANT`, `REVOKE`, `LOCK`
- `COPY`, `VACUUM`, `ANALYZE`, `REINDEX`, `CLUSTER`

### Additional strict-mode checks

- Multiple SQL statements in one request are blocked
- Certain risky function calls are blocked (for example `pg_sleep`, `dblink`, file-read functions)
- Final row cap is enforced server-side, even if your SQL includes a larger `LIMIT`

### Execution limits

- `preview_data` default: `10`, max: `100`
- `run_query` default: `1000`, max: `5000`
- Query timeout: `30s` (`statement_timeout` and `query_timeout`)
- Long text truncation: `200` chars

### Error safety

Connection and runtime errors are sanitized to prevent credential leakage.

## Common Usage Examples

### Example 1: List all public tables

Use `list_tables` with:

```json
{ "database": "db", "schema": "public" }
```

### Example 2: Preview recent mails

Use `run_query` with:

```json
{
  "database": "db",
  "query": "SELECT id, subject, \"createdAt\" FROM \"public\".\"Mail\" ORDER BY \"createdAt\" DESC",
  "limit": 20
}
```

### Example 3: Compare two databases

1. Call `db_stats` with `database: "db"`
2. Call `db_stats` with `database: "db2"`
3. Compare `totalTables`, `totalRows`, and `largestTables`

## Development

```bash
# Type-check and compile
npm run build

# Run server in dev mode
npm run dev

# Start compiled server
npm start

# Run tests
npm test
```

## Release to npm

```bash
# Patch release (1.0.0 -> 1.0.1)
npm run release

# Minor release (1.0.0 -> 1.1.0)
npm run release:minor

# Major release (1.0.0 -> 2.0.0)
npm run release:major

# Validate flow without changing anything
npm run release:dry-run
```

Release script behavior:

- Requires a clean git working tree
- Uses `npm version` to bump version (creates commit and tag)
- Runs `npm publish --access public` (build runs via `prepublishOnly`)

## Troubleshooting

### Connection fails

- Verify host/port is reachable from your machine.
- Verify user/password and database name.
- If using URL, ensure special chars in password are URL encoded.

### Server starts but no tools in client

- Confirm client points to correct `dist/index.js` path.
- Restart client app after config changes.
- Check stderr logs for startup errors.

### Query rejected

- The query likely includes blocked keywords or unsupported statement type.
- Rewrite as strict read-only query (`SELECT` only).

## License

MIT
