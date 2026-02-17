/**
 * Database configuration interface
 */
export interface DatabaseConfig {
    name: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

/**
 * Query result interface
 */
export interface QueryResult {
    rows: Record<string, unknown>[];
    fields: FieldInfo[];
    rowCount: number;
    truncated: boolean;
}

/**
 * Field information from query result
 */
export interface FieldInfo {
    name: string;
    type: string;
}

/**
 * Validation result from query validator
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    queryType?: 'SELECT' | 'SHOW' | 'DESCRIBE' | 'EXPLAIN';
}

/**
 * Table information
 */
export interface TableInfo {
    name: string;
    type: string; // 'BASE TABLE' | 'VIEW'
    rowCount: number;
    schema: string; // PostgreSQL specific: schema name
}

/**
 * Column information for table schema
 */
export interface ColumnInfo {
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    extra: string; // Used for things like auto-increment (serial)
    comment: string;
}

/**
 * Foreign key information
 */
export interface ForeignKeyInfo {
    name: string;
    column: string;
    referencedTable: string;
    referencedColumn: string;
}

/**
 * Index information for table schema
 */
export interface IndexInfo {
    name: string;
    columns: string[];
    unique: boolean;
    type: string;
}

/**
 * Relation information for table relationships
 */
export interface RelationInfo {
    table: string;
    column: string;
    foreignKey: string;
    relationType: 'one-to-one' | 'one-to-many';
}

/**
 * Table statistics
 */
export interface TableStat {
    table: string;
    rows: number;
    size: string;
}

/**
 * Query execution limits
 */
export const LIMITS = {
    PREVIEW_DEFAULT: 10,
    PREVIEW_MAX: 100,
    QUERY_DEFAULT: 1000,
    QUERY_MAX: 5000,
    TIMEOUT_MS: 30000,
    TEXT_TRUNCATE: 200
} as const;
