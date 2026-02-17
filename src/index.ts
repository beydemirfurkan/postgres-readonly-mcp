#!/usr/bin/env node
/**
 * PostgreSQL Read-Only MCP Server Entry Point
 * 
 * MCP server that provides read-only access to PostgreSQL databases.
 * Supports DB and DB2 connections with tools for:
 * - Listing tables
 * - Describing table schemas
 * - Previewing data
 * - Running custom SELECT queries
 * - Showing table relationships
 * - Getting database statistics
 * 
 * @module index
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ErrorCode,
    McpError
} from '@modelcontextprotocol/sdk/types.js';

import { ConnectionManager, createConfigFromEnv, DatabaseType } from './connection-manager.js';
import { listTables, ListTablesInput } from './tools/list-tables.js';
import { describeTable, DescribeTableInput } from './tools/describe-table.js';
import { previewData, PreviewDataInput } from './tools/preview-data.js';
import { runQuery, RunQueryInput } from './tools/run-query.js';
import { showRelations, ShowRelationsInput } from './tools/show-relations.js';
import { dbStats, DbStatsInput } from './tools/db-stats.js';

/**
 * Server configuration
 */
const SERVER_NAME = 'postgres-readonly-mcp';
const SERVER_VERSION = '1.0.0';

function normalizeDatabase(input: unknown): DatabaseType | undefined {
    if (input === 'db' || input === 'db2') {
        return input;
    }

    return undefined;
}

/**
 * Tool definitions for MCP protocol
 */
const TOOL_DEFINITIONS = [
    {
        name: 'list_tables',
        description: 'Lists all tables in a database with their type (BASE TABLE or VIEW), row count estimate, and schema.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                database: {
                    type: 'string',
                    enum: ['db', 'db2'],
                    description: 'Database to list tables from. Defaults to "db".'
                },
                schema: {
                    type: 'string',
                    description: 'Schema to list tables from. Defaults to "public".'
                }
            }
        }
    },
    {
        name: 'describe_table',
        description: 'Returns detailed schema information for a table including columns (name, type, nullable, default), primary key, and foreign keys.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                table: {
                    type: 'string',
                    description: 'Name of the table to describe.'
                },
                database: {
                    type: 'string',
                    enum: ['db', 'db2'],
                    description: 'Database containing the table. Defaults to "db".'
                },
                schema: {
                    type: 'string',
                    description: 'Schema containing the table. Defaults to "public".'
                }
            },
            required: ['table']
        }
    },
    {
        name: 'preview_data',
        description: 'Previews table data with optional column selection, WHERE clause filtering, and automatic text truncation.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                table: {
                    type: 'string',
                    description: 'Name of the table to preview.'
                },
                database: {
                    type: 'string',
                    enum: ['db', 'db2'],
                    description: 'Database containing the table. Defaults to "db".'
                },
                schema: {
                    type: 'string',
                    description: 'Schema containing the table. Defaults to "public".'
                },
                columns: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Specific columns to return. Returns all columns if not specified.'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum rows to return (default: 10, max: 100).'
                },
                where: {
                    type: 'string',
                    description: 'Optional SQL WHERE clause fragment. Example: "status = \'sent\'".'
                }
            },
            required: ['table']
        }
    },
    {
        name: 'run_query',
        description: 'Executes a custom SELECT query with validation. Only SELECT, SHOW, EXPLAIN statements are allowed. Results are limited.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                query: {
                    type: 'string',
                    description: 'SQL query to execute. Must be a read-only query.'
                },
                database: {
                    type: 'string',
                    enum: ['db', 'db2'],
                    description: 'Database to run the query against. Defaults to "db".'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum rows to return (default: 1000, max: 5000).'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'show_relations',
        description: 'Shows all foreign key relationships for a table, including tables that reference this table and tables this table references.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                table: {
                    type: 'string',
                    description: 'Name of the table to show relationships for.'
                },
                database: {
                    type: 'string',
                    enum: ['db', 'db2'],
                    description: 'Database containing the table. Defaults to "db".'
                },
                schema: {
                    type: 'string',
                    description: 'Schema containing the table. Defaults to "public".'
                }
            },
            required: ['table']
        }
    },
    {
        name: 'db_stats',
        description: 'Returns database statistics including total table count, total row count estimate, and database size.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                database: {
                    type: 'string',
                    enum: ['db', 'db2'],
                    description: 'Database to get statistics for. Defaults to "db".'
                }
            }
        }
    }
];

/**
 * Creates and configures the MCP server
 */
async function createServer(): Promise<Server> {
    const server = new Server(
        {
            name: SERVER_NAME,
            version: SERVER_VERSION
        },
        {
            capabilities: {
                tools: {}
            }
        }
    );

    // Initialize connection manager
    const connectionManager = new ConnectionManager();
    const configs = createConfigFromEnv();

    await connectionManager.initialize(configs.db, configs.db2);

    // Register list tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: TOOL_DEFINITIONS
        };
    });

    // Register call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            switch (name) {
                case 'list_tables': {
                    const input: ListTablesInput = {
                        database: normalizeDatabase(args?.database),
                        schema: (args?.schema as string) || undefined
                    };
                    const result = await listTables(connectionManager, input);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                }

                case 'describe_table': {
                    if (!args?.table) {
                        throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: table');
                    }
                    const input: DescribeTableInput = {
                        table: args.table as string,
                        database: normalizeDatabase(args?.database),
                        schema: (args?.schema as string) || undefined
                    };
                    const result = await describeTable(connectionManager, input);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                }

                case 'preview_data': {
                    if (!args?.table) {
                        throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: table');
                    }
                    const input: PreviewDataInput = {
                        table: args.table as string,
                        database: normalizeDatabase(args?.database),
                        schema: (args?.schema as string) || undefined,
                        columns: args?.columns as string[] | undefined,
                        limit: args?.limit as number | undefined,
                        where: args?.where as string | undefined
                    };
                    const result = await previewData(connectionManager, input);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                }

                case 'run_query': {
                    if (!args?.query) {
                        throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: query');
                    }
                    const input: RunQueryInput = {
                        query: args.query as string,
                        database: normalizeDatabase(args?.database),
                        limit: args?.limit as number | undefined
                    };
                    const result = await runQuery(connectionManager, input);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                }

                case 'show_relations': {
                    if (!args?.table) {
                        throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: table');
                    }
                    const input: ShowRelationsInput = {
                        table: args.table as string,
                        database: normalizeDatabase(args?.database),
                        schema: (args?.schema as string) || undefined
                    };
                    const result = await showRelations(connectionManager, input);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                }

                case 'db_stats': {
                    const input: DbStatsInput = {
                        database: normalizeDatabase(args?.database)
                    };
                    const result = await dbStats(connectionManager, input);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                }

                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
            }
        } catch (error) {
            if (error instanceof McpError) {
                throw error;
            }

            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new McpError(ErrorCode.InternalError, errorMessage);
        }
    });

    // Handle server shutdown
    process.on('SIGINT', async () => {
        await connectionManager.close();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await connectionManager.close();
        process.exit(0);
    });

    return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    try {
        const server = await createServer();
        const transport = new StdioServerTransport();

        await server.connect(transport);

        // Log to stderr to avoid interfering with stdio transport
        console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
    } catch (error) {
        console.error('Failed to start MCP server:', error);
        process.exit(1);
    }
}

// Run the server
main();
