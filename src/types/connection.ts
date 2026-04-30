// Connection types for Neo4j and OpenAI
export interface Neo4jCredentials {
  url: string;
  database: string;
  username: string;
  password: string;
}

export interface OpenAICredentials {
  apiKey: string;
}

export interface ConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  neo4jCredentials: Neo4jCredentials | null;
  openaiCredentials: OpenAICredentials | null;
  databaseNodeCount: number | null;
  error: string | null;
}

export interface QueryResult {
  records: Record<string, unknown>[];
  summary: {
    query: string;
    parameters: Record<string, unknown>;
    serverAddress: string;
    database: string;
    resultAvailableAfter: number;
    resultConsumedAfter: number;
  };
}
