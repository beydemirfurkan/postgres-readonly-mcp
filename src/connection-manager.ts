/**
 * Connection Manager Module
 * 
 * Manages PostgreSQL database connections.
 * Provides connection pooling and query execution with timeout handling.
 * 
 * @module connection-manager
 */

import pg, { Pool } from 'pg';
import { DatabaseConfig, QueryResult, FieldInfo, LIMITS } from './types.js';
import { validate } from './query-validator.js';

/**
 * Database type identifier
 */
export type DatabaseType = 'db' | 'db2';

/**
 * Sensitive patterns to sanitize from error messages and logs
 */
const SENSITIVE_PATTERNS = [
    /password[=:]\s*['"]?[^'"\s]+['"]?/gi,
    /pwd[=:]\s*['"]?[^'"\s]+['"]?/gi,
    /secret[=:]\s*['"]?[^'"\s]+['"]?/gi,
    /token[=:]\s*['"]?[^'"\s]+['"]?/gi,
    /key[=:]\s*['"]?[^'"\s]+['"]?/gi,
    // Postgres connection string format: postgres://user:password@host...
    /postgres:\/\/[^:]+:.+@[a-zA-Z0-9.-]+/gi,
    /postgresql:\/\/[^:]+:.+@[a-zA-Z0-9.-]+/gi
];

/**
 * Sanitizes sensitive data from a string
 */
export function sanitizeMessage(message: string): string {
    let sanitized = message;

    for (const pattern of SENSITIVE_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
    }

    return sanitized;
}

/**
 * Creates a safe error message without exposing credentials
 */
export function createConnectionErrorMessage(config: DatabaseConfig, error: Error): string {
    const safeDetails = `${config.name}@${config.host}:${config.port}/${config.database}`;
    const sanitizedError = sanitizeMessage(error.message);

    return `Database connection failed: ${safeDetails} - ${sanitizedError}`;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) {
        return defaultValue;
    }

    const normalized = value.trim().toLowerCase();

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return defaultValue;
}


/**
 * Connection Manager class
 * Manages database connection pools and query execution
 */
export class ConnectionManager {
    private pools: Map<DatabaseType, Pool> = new Map();
    private configs: Map<DatabaseType, DatabaseConfig> = new Map();

    /**
     * Initializes connection pools for the given database configurations
     */
    async initialize(dbConfig: DatabaseConfig, db2Config: DatabaseConfig): Promise<void> {
        this.configs.set('db', dbConfig);
        this.configs.set('db2', db2Config);

        const dbPool = this.createPool(dbConfig);
        this.pools.set('db', dbPool);

        const db2Pool = this.createPool(db2Config);
        this.pools.set('db2', db2Pool);
    }

    /**
     * Creates a PostgreSQL connection pool with optimized settings
     */
    private createPool(config: DatabaseConfig): Pool {
        const ssl = config.ssl
            ? { rejectUnauthorized: config.sslRejectUnauthorized ?? true }
            : undefined;

        return new pg.Pool({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            max: 5, // connectionLimit
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 5000,
            statement_timeout: LIMITS.TIMEOUT_MS,
            query_timeout: LIMITS.TIMEOUT_MS,
            application_name: 'postgres-readonly-mcp',
            ssl,
        });
    }

    /**
     * Gets the connection pool for a specific database
     */
    getPool(database: DatabaseType): Pool {
        const pool = this.pools.get(database);

        if (!pool) {
            throw new Error(`Connection pool not initialized for database: ${database}`);
        }

        return pool;
    }

    /**
     * Tests connection to a specific database
     */
    async testConnection(database: DatabaseType): Promise<void> {
        const pool = this.getPool(database);
        const config = this.configs.get(database);

        try {
            const client = await pool.connect();
            client.release();
        } catch (error) {
            if (config) {
                throw new Error(createConnectionErrorMessage(config, error as Error));
            }
            throw new Error(`Database connection failed: ${database}`);
        }
    }


    /**
     * Executes a read-only query with timeout handling
     */
    async executeQuery(
        database: DatabaseType,
        query: string,
        params: unknown[] = [],
        limit?: number
    ): Promise<QueryResult> {
        // Validate query is read-only
        const validation = validate(query);

        if (!validation.valid) {
            throw new Error(validation.error || 'Invalid query');
        }

        const pool = this.getPool(database);
        const requestedLimit = limit ?? LIMITS.QUERY_DEFAULT;
        const effectiveLimit = Math.max(1, Math.min(requestedLimit, LIMITS.QUERY_MAX));

        try {
            const result = await this.executeWithLimit(pool, query, params, effectiveLimit);
            return result;
        } catch (error) {
            // Sanitize error message before throwing
            const sanitizedMessage = sanitizeMessage((error as Error).message);
            throw new Error(sanitizedMessage);
        }
    }

    /**
     * Executes query with row limit enforcement
     */
    private async executeWithLimit(
        pool: Pool,
        query: string,
        params: unknown[],
        limit: number
    ): Promise<QueryResult> {
        // Request one more row than limit to detect truncation
        const queryWithLimit = this.wrapQueryWithLimit(query, limit + 1);

        const result = await pool.query(queryWithLimit, params);

        const rows = result.rows;

        // Check if results were truncated
        const truncated = rows.length > limit;
        const resultRows = truncated ? rows.slice(0, limit) : rows;

        // Map field info
        const fields: FieldInfo[] = result.fields.map(field => ({
            name: field.name,
            type: this.getFieldTypeName(field.dataTypeID) // dataTypeID is the OID in pg
        }));

        return {
            rows: resultRows,
            fields: fields,
            rowCount: resultRows.length,
            truncated
        };
    }

    private wrapQueryWithLimit(query: string, limit: number): string {
        const trimmedQuery = query.trim().replace(/;\s*$/, '');
        return `SELECT * FROM (${trimmedQuery}) AS mcp_readonly_subquery LIMIT ${limit}`;
    }

    /**
     * Converts PostgreSQL OID to string name
     * This is a simplified map, might need more extensive mapping or query pg_type
     */
    private getFieldTypeName(oid: number): string {
        // Common OIDs from pg-types or standard postgres
        const typeMap: Record<number, string> = {
            16: 'BOOL',
            17: 'BYTEA',
            18: 'CHAR',
            19: 'NAME',
            20: 'INT8',
            21: 'INT2',
            23: 'INT4',
            25: 'TEXT',
            114: 'JSON',
            700: 'FLOAT4',
            701: 'FLOAT8',
            1043: 'VARCHAR',
            1082: 'DATE',
            1114: 'TIMESTAMP',
            1184: 'TIMESTAMPTZ',
            3802: 'JSONB'
        };

        return typeMap[oid] || `OID(${oid})`;
    }


    /**
     * Closes all connection pools
     */
    async close(): Promise<void> {
        const closePromises: Promise<void>[] = [];

        for (const [, pool] of this.pools) {
            closePromises.push(pool.end());
        }

        await Promise.all(closePromises);
        this.pools.clear();
        this.configs.clear();
    }
}

/**
 * Creates database configuration from environment variables
 * 
 * @returns Object with DB and DB2 database configs
 */
function decodeUrlComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function parseDatabaseUrl(connectionString: string): Omit<DatabaseConfig, 'name'> {
    const parsed = new URL(connectionString);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
        throw new Error(`Unsupported database protocol in URL: ${parsed.protocol}`);
    }

    const database = parsed.pathname.replace(/^\/+/, '');

    if (!database) {
        throw new Error('Database name is missing in DATABASE_URL');
    }

    return {
        host: parsed.hostname || 'localhost',
        port: parsed.port ? parseInt(parsed.port, 10) : 5432,
        user: parsed.username ? decodeUrlComponent(parsed.username) : 'postgres',
        password: parsed.password ? decodeUrlComponent(parsed.password) : '',
        database
    };
}

export function createConfigFromEnv(): { db: DatabaseConfig; db2: DatabaseConfig } {
    const dbUrl = process.env.DB_URL || process.env.DB_DATABASE_URL || process.env.DATABASE_URL;
    const db2Url = process.env.DB2_URL || process.env.DB2_DATABASE_URL || process.env.DATABASE_URL;

    const dbFromUrl = dbUrl ? parseDatabaseUrl(dbUrl) : null;
    const db2FromUrl = db2Url ? parseDatabaseUrl(db2Url) : null;

    const db: DatabaseConfig = {
        name: 'db',
        host: process.env.DB_HOST || dbFromUrl?.host || 'localhost',
        port: parseInt(process.env.DB_PORT || String(dbFromUrl?.port || 5432), 10),
        user: process.env.DB_USER || dbFromUrl?.user || 'postgres',
        password: process.env.DB_PASSWORD || dbFromUrl?.password || '',
        database: process.env.DB_NAME || dbFromUrl?.database || 'postgres',
        ssl: parseBooleanEnv(process.env.DB_SSL, true),
        sslRejectUnauthorized: parseBooleanEnv(process.env.DB_SSL_REJECT_UNAUTHORIZED, true)
    };

    const db2: DatabaseConfig = {
        name: 'db2',
        host: process.env.DB2_HOST || db2FromUrl?.host || db.host || 'localhost',
        port: parseInt(process.env.DB2_PORT || String(db2FromUrl?.port || db.port || 5432), 10),
        user: process.env.DB2_USER || db2FromUrl?.user || db.user || 'postgres',
        password: process.env.DB2_PASSWORD || db2FromUrl?.password || db.password || '',
        database: process.env.DB2_NAME || db2FromUrl?.database || 'postgres',
        ssl: parseBooleanEnv(process.env.DB2_SSL, db.ssl ?? false),
        sslRejectUnauthorized: parseBooleanEnv(process.env.DB2_SSL_REJECT_UNAUTHORIZED, db.sslRejectUnauthorized ?? true)
    };

    return { db, db2 };
}

/**
 * Connection Manager interface for dependency injection
 */
export interface IConnectionManager {
    initialize(dbConfig: DatabaseConfig, db2Config: DatabaseConfig): Promise<void>;
    getPool(database: DatabaseType): Pool;
    testConnection(database: DatabaseType): Promise<void>;
    executeQuery(
        database: DatabaseType,
        query: string,
        params?: unknown[],
        limit?: number
    ): Promise<QueryResult>;
    close(): Promise<void>;
}

/**
 * Default connection manager instance
 */
export const connectionManager = new ConnectionManager();
