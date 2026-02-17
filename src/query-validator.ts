/**
 * Query Validator Module
 * 
 * Validates SQL queries to ensure only read-only operations are allowed.
 * Prevents SQL injection and data modification attempts.
 * 
 * @module query-validator
 */

import { ValidationResult } from './types.js';

/**
 * List of forbidden SQL keywords that indicate data modification
 */
export const FORBIDDEN_KEYWORDS = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'ALTER',
    'TRUNCATE',
    'CREATE',
    'REPLACE',
    'GRANT',
    'REVOKE',
    'LOCK',
    // 'UNLOCK' // UNLOCK is not a keyword in Postgres in the same way, but LOCK is.
    // Postgres specific administrative commands can be added if needed, but these cover the basics.
    'COPY', // COPY TO/FROM can be used for data export/import, often restricted but good to block.
    'VACUUM',
    'ANALYZE',
    'REINDEX',
    'CLUSTER'
] as const;

/**
 * Patterns that are allowed even though they contain forbidden keywords
 * These are read-only commands that display information about objects
 */
const ALLOWED_PATTERNS_WITH_FORBIDDEN_KEYWORDS = [
    /^EXPLAIN\s+/i,                  // EXPLAIN can contain any query for analysis
    /^SHOW\s+/i                      // SHOW commands in Postgres are generally safe configuration views
] as const;

/**
 * List of allowed SQL statement types (read-only operations)
 */
export const ALLOWED_STATEMENTS = ['SELECT', 'SHOW', 'EXPLAIN', 'VALUES', 'WITH'] as const;
// Added VALUES and WITH as they can be used for CTEs and data generation in read-only context.

type AllowedStatement = typeof ALLOWED_STATEMENTS[number];

/**
 * Normalizes a query by removing comments and extra whitespace
 */
function normalizeQuery(query: string): string {
    return query
        // Remove single-line comments (both -- and # for some dialects, Postgres uses --)
        .replace(/--.*$/gm, '')
        // Remove multi-line comments
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts the first keyword from a normalized query
 */
function getFirstKeyword(normalizedQuery: string): string {
    const match = normalizedQuery.match(/^(\w+)/i);
    return match ? match[1].toUpperCase() : '';
}

/**
 * Checks if a query matches any allowed pattern that contains forbidden keywords
 */
function matchesAllowedPattern(normalizedQuery: string): boolean {
    return ALLOWED_PATTERNS_WITH_FORBIDDEN_KEYWORDS.some(pattern => pattern.test(normalizedQuery));
}

/**
 * Checks if a query contains any forbidden keywords
 * Uses word boundary matching to avoid false positives
 */
function containsForbiddenKeyword(normalizedQuery: string): string | null {
    // If the query matches an allowed pattern, don't check for forbidden keywords
    if (matchesAllowedPattern(normalizedQuery)) {
        return null;
    }

    const upperQuery = normalizedQuery.toUpperCase();

    for (const keyword of FORBIDDEN_KEYWORDS) {
        // Use word boundary regex to match whole words only
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(upperQuery)) {
            return keyword;
        }
    }

    return null;
}

/**
 * Checks if a query is read-only (starts with allowed statement and contains no forbidden keywords)
 * 
 * @param query - The SQL query to validate
 * @returns true if the query is read-only, false otherwise
 */
export function isReadOnly(query: string): boolean {
    if (!query || typeof query !== 'string') {
        return false;
    }

    const normalizedQuery = normalizeQuery(query);

    if (!normalizedQuery) {
        return false;
    }

    // Check if query starts with an allowed statement
    const firstKeyword = getFirstKeyword(normalizedQuery);
    const isAllowedStatement = ALLOWED_STATEMENTS.includes(firstKeyword as AllowedStatement);

    if (!isAllowedStatement) {
        return false;
    }

    // Check for forbidden keywords anywhere in the query
    const forbiddenKeyword = containsForbiddenKeyword(normalizedQuery);

    return forbiddenKeyword === null;
}

/**
 * Validates a query and returns detailed validation result
 * 
 * @param query - The SQL query to validate
 * @returns ValidationResult with valid status, error message, and query type
 */
export function validate(query: string): ValidationResult {
    // Check for empty or invalid input
    if (!query || typeof query !== 'string') {
        return {
            valid: false,
            error: 'Query must be a non-empty string'
        };
    }

    const normalizedQuery = normalizeQuery(query);

    if (!normalizedQuery) {
        return {
            valid: false,
            error: 'Query cannot be empty or contain only whitespace/comments'
        };
    }

    // Get the first keyword to determine query type
    const firstKeyword = getFirstKeyword(normalizedQuery);

    // Check if it's an allowed statement type
    if (!ALLOWED_STATEMENTS.includes(firstKeyword as AllowedStatement)) {
        return {
            valid: false,
            error: `Query rejected: Only ${ALLOWED_STATEMENTS.join(', ')} statements are allowed. Found: ${firstKeyword || 'unknown'}`
        };
    }

    // Check for forbidden keywords
    const forbiddenKeyword = containsForbiddenKeyword(normalizedQuery);

    if (forbiddenKeyword) {
        return {
            valid: false,
            error: `Query rejected: Contains forbidden keyword '${forbiddenKeyword}'. Data modification is not allowed.`
        };
    }

    return {
        valid: true,
        queryType: firstKeyword as ValidationResult['queryType']
    };
}

/**
 * Query Validator interface for dependency injection
 */
export interface QueryValidator {
    validate(query: string): ValidationResult;
    isReadOnly(query: string): boolean;
}

/**
 * Default query validator instance
 */
export const queryValidator: QueryValidator = {
    validate,
    isReadOnly
};
