import { ConnectionManager, DatabaseType } from '../connection-manager.js';
import { TableStat } from '../types.js';

export interface DbStatsInput {
    database?: DatabaseType;
}

export interface DatabaseStats {
    database: string;
    totalTables: number;
    totalRows: number;
    totalSize: string;
    largestTables: TableStat[];
}

export async function dbStats(
    connectionManager: ConnectionManager,
    input: DbStatsInput
): Promise<DatabaseStats> {
    const database = input.database || 'db';

    // Get database size
    const sizeQuery = `
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
    const sizeResult = await connectionManager.executeQuery(database, sizeQuery, []);
    const totalSize = sizeResult.rows[0].size as string;

    // Get table counts and total rows
    // pg_stat_user_tables is faster but approximate
    const statsQuery = `
    SELECT 
      count(*) as table_count, 
      sum(n_live_tup) as total_rows 
    FROM 
      pg_stat_user_tables
  `;
    const statsResult = await connectionManager.executeQuery(database, statsQuery, []);
    const totalTables = parseInt(statsResult.rows[0].table_count as string, 10);
    const totalRows = parseInt(statsResult.rows[0].total_rows as string || '0', 10);

    // Get largest tables
    const largestTablesQuery = `
    SELECT
      relname as table_name,
      n_live_tup as row_count,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size
    FROM
      pg_stat_user_tables
    ORDER BY
      n_live_tup DESC NULLS LAST
    LIMIT 10
  `;

    const largestTablesResult = await connectionManager.executeQuery(database, largestTablesQuery, []);

    const largestTables: TableStat[] = largestTablesResult.rows.map(row => ({
        table: row.table_name as string,
        rows: parseInt(row.row_count as string || '0', 10),
        size: row.total_size as string
    }));

    return {
        database,
        totalTables,
        totalRows,
        totalSize,
        largestTables
    };
}
