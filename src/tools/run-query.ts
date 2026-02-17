import { ConnectionManager, DatabaseType } from '../connection-manager.js';
import { QueryResult, LIMITS } from '../types.js';

export interface RunQueryInput {
    query: string;
    database?: DatabaseType;
    limit?: number;
}

export async function runQuery(
    connectionManager: ConnectionManager,
    input: RunQueryInput
): Promise<QueryResult> {
    const database = input.database || 'db';
    const limit = Math.min(input.limit || LIMITS.QUERY_DEFAULT, LIMITS.QUERY_MAX);

    return await connectionManager.executeQuery(database, input.query, [], limit);
}
