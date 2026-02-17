import { ConnectionManager, DatabaseType } from '../connection-manager.js';
import { RelationInfo } from '../types.js';

export interface ShowRelationsInput {
    table: string;
    database?: DatabaseType;
    schema?: string;
}

export async function showRelations(
    connectionManager: ConnectionManager,
    input: ShowRelationsInput
): Promise<RelationInfo[]> {
    const database = input.database || 'db';
    const schema = input.schema || 'public';
    const table = input.table;

    const query = `
    SELECT
      kcu.table_name as table_name,
      kcu.column_name as column_name,
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
      AND (
        (tc.table_schema = $1 AND tc.table_name = $2)
        OR
        (ccu.table_schema = $1 AND ccu.table_name = $2)
      )
  `;

    const result = await connectionManager.executeQuery(database, query, [schema, table]);

    const relations: RelationInfo[] = [];

    for (const row of result.rows) {
        const tableName = row.table_name as string;
        // const columnName = row.column_name as string;
        const referencedTable = row.referenced_table_name as string;
        // const referencedColumn = row.referenced_column_name as string;
        const constraintName = row.constraint_name as string;

        if (tableName === table) {
            // Outgoing relation (this table references another)
            relations.push({
                table: referencedTable,
                column: row.column_name as string,
                foreignKey: constraintName,
                relationType: 'one-to-one' // Simplified assumption, detecting true 1:1 vs 1:N requires unique constraint check
            });
        } else {
            // Incoming relation (other table references this one)
            relations.push({
                table: tableName,
                column: row.column_name as string,
                foreignKey: constraintName,
                relationType: 'one-to-many' // Usually incoming FK means 1:N
            });
        }
    }

    return relations;
}
