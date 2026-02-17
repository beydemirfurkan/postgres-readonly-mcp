import { ConnectionManager, DatabaseType } from '../connection-manager.js';
import { QueryResult, LIMITS } from '../types.js';

export interface PreviewDataInput {
    table: string;
    database?: DatabaseType;
    schema?: string;
    columns?: string[];
    limit?: number;
    where?: string;
}

export async function previewData(
    connectionManager: ConnectionManager,
    input: PreviewDataInput
): Promise<QueryResult> {
    const database = input.database || 'db';
    const schema = input.schema || 'public';
    const table = input.table;
    const limit = Math.min(input.limit || LIMITS.PREVIEW_DEFAULT, LIMITS.PREVIEW_MAX);

    // Construct query
    const columnSelection = input.columns && input.columns.length > 0
        ? input.columns.map(c => `"${c}"`).join(', ')
        : '*';

    let query = `SELECT ${columnSelection} FROM "${schema}"."${table}"`;

    if (input.where) {
        query += ` WHERE ${input.where}`;
    }

    // Limit is handled by executeQuery, but we pass it explicitly
    // Note: executeQuery adds LIMIT if not present, but we want to ensure we don't fetch too many

    const result = await connectionManager.executeQuery(database, query, [], limit);

    // Post-process to truncate long text fields
    const processedRows = result.rows.map(row => {
        const newRow: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(row)) {
            if (typeof value === 'string' && value.length > LIMITS.TEXT_TRUNCATE) {
                newRow[key] = value.substring(0, LIMITS.TEXT_TRUNCATE) + '... (truncated)';
            } else {
                newRow[key] = value;
            }
        }

        return newRow;
    });

    return {
        ...result,
        rows: processedRows
    };
}
