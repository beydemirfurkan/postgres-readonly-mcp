import { ConnectionManager, DatabaseType } from '../connection-manager.js';
import { ColumnInfo, ForeignKeyInfo, IndexInfo } from '../types.js';

export interface DescribeTableInput {
    table: string;
    database?: DatabaseType;
    schema?: string;
}

export interface TableDescription {
    table: string;
    schema: string;
    columns: ColumnInfo[];
    primaryKey: string[];
    foreignKeys: ForeignKeyInfo[];
    indexes: IndexInfo[];
}

export async function describeTable(
    connectionManager: ConnectionManager,
    input: DescribeTableInput
): Promise<TableDescription> {
    const database = input.database || 'db';
    const schema = input.schema || 'public';
    const table = input.table;

    // Get columns
    const columnsQuery = `
    SELECT 
      column_name,
      data_type,
      is_nullable,
      column_default,
      '' as extra, 
      NULL as column_comment
    FROM 
      information_schema.columns
    WHERE 
      table_schema = $1 AND table_name = $2
    ORDER BY 
      ordinal_position
  `;

    const columnsResult = await connectionManager.executeQuery(database, columnsQuery, [schema, table]);

    const columns: ColumnInfo[] = columnsResult.rows.map(row => ({
        name: row.column_name as string,
        type: row.data_type as string,
        nullable: row.is_nullable === 'YES',
        default: row.column_default as string | null,
        extra: row.extra as string,
        comment: (row.column_comment as string) || ''
    }));

    // Get primary key
    const pkQuery = `
    SELECT 
      kcu.column_name
    FROM 
      information_schema.table_constraints tc
    JOIN 
      information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name 
      AND tc.table_schema = kcu.table_schema
    WHERE 
      tc.constraint_type = 'PRIMARY KEY' 
      AND tc.table_schema = $1 
      AND tc.table_name = $2
    ORDER BY 
      kcu.ordinal_position
  `;

    const pkResult = await connectionManager.executeQuery(database, pkQuery, [schema, table]);
    const primaryKey = pkResult.rows.map(row => row.column_name as string);

    // Get foreign keys
    const fkQuery = `
    SELECT
      kcu.column_name,
      ccu.table_name AS referenced_table_name,
      ccu.column_name AS referenced_column_name,
      tc.constraint_name
    FROM 
      information_schema.table_constraints AS tc 
    JOIN 
      information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN 
      information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE 
      tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_schema = $1
      AND tc.table_name = $2
  `;

    const fkResult = await connectionManager.executeQuery(database, fkQuery, [schema, table]);

    const foreignKeys: ForeignKeyInfo[] = fkResult.rows.map(row => ({
        name: row.constraint_name as string,
        column: row.column_name as string,
        referencedTable: row.referenced_table_name as string,
        referencedColumn: row.referenced_column_name as string
    }));

    // Get indexes (simplified for Postgres using pg_indexes)
    const indexQuery = `
    SELECT
      indexname as index_name,
      indexdef as index_definition
    FROM
      pg_indexes
    WHERE
      schemaname = $1
      AND tablename = $2
  `;

    const indexResult = await connectionManager.executeQuery(database, indexQuery, [schema, table]);

    const indexes: IndexInfo[] = indexResult.rows.map(row => {
        const def = row.index_definition as string;
        const isUnique = def.includes('UNIQUE INDEX');
        // Extract columns from definition like "CREATE INDEX ... ON ... (col1, col2)"
        const match = def.match(/\(([^)]+)\)/);
        const cols = match ? match[1].split(',').map(c => c.trim()) : [];

        return {
            name: row.index_name as string,
            columns: cols,
            unique: isUnique,
            type: 'BTREE' // Default assumption or parse from def
        };
    });

    return {
        table,
        schema,
        columns,
        primaryKey,
        foreignKeys,
        indexes
    };
}
