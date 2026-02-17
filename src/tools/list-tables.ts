import { ConnectionManager, DatabaseType } from '../connection-manager.js';
import { TableInfo } from '../types.js';

export interface ListTablesInput {
    database?: DatabaseType;
    schema?: string;
}

export async function listTables(
    connectionManager: ConnectionManager,
    input: ListTablesInput
): Promise<TableInfo[]> {
    const database = input.database || 'db';
    const schema = input.schema || 'public';

    const query = `
    SELECT 
      t.table_name,
      t.table_type,
      COALESCE(s.n_live_tup, 0) as row_count_estimate,
      t.table_schema
    FROM 
      information_schema.tables t
    LEFT JOIN 
      pg_stat_user_tables s ON t.table_name = s.relname AND t.table_schema = s.schemaname
    WHERE 
      t.table_schema = $1
    ORDER BY 
      t.table_name
  `;

    const result = await connectionManager.executeQuery(database, query, [schema]);

    return result.rows.map(row => ({
        name: row.table_name as string,
        type: (row.table_type as string) === 'BASE TABLE' ? 'BASE TABLE' : 'VIEW',
        rowCount: parseInt(row.row_count_estimate as string, 10),
        schema: row.table_schema as string
    }));
}
