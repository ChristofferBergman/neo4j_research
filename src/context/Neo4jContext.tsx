import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { driver, Driver, Session, auth } from 'neo4j-driver';
import type { Neo4jCredentials, OpenAICredentials, ConnectionState } from '../types/connection';

interface Neo4jContextType extends ConnectionState {
  connect: (neo4j: Neo4jCredentials, openai: OpenAICredentials) => Promise<boolean>;
  disconnect: () => void;
  reconnect: () => void;
  executeQuery: (query: string, parameters?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  getSession: () => Session | null;
}

const Neo4jContext = createContext<Neo4jContextType | null>(null);

const STORAGE_KEYS = {
  NEO4J_URL: 'neo4j_research_url',
  NEO4J_DATABASE: 'neo4j_research_database',
  NEO4J_USERNAME: 'neo4j_research_username',
  OPENAI_API_KEY: 'neo4j_research_openai_key',
};

type Neo4jDriverError = Error & {
  code?: string;
  cause?: unknown;
  gqlStatus?: string;
  gqlStatusDescription?: string;
  diagnosticRecord?: unknown;
};

function serializeError(error: unknown, depth = 0): unknown {
  if (depth > 2 || error == null) {
    return error;
  }

  if (error instanceof Error) {
    const neo4jError = error as Neo4jDriverError;
    return {
      name: neo4jError.name,
      message: neo4jError.message,
      code: neo4jError.code,
      gqlStatus: neo4jError.gqlStatus,
      gqlStatusDescription: neo4jError.gqlStatusDescription,
      diagnosticRecord: neo4jError.diagnosticRecord,
      stack: neo4jError.stack,
      cause: serializeError(neo4jError.cause, depth + 1),
    };
  }

  if (typeof error === 'object') {
    return Object.fromEntries(
      Object.entries(error).map(([key, value]) => [key, serializeError(value, depth + 1)])
    );
  }

  return error;
}

function getErrorMessage(error: unknown): string {
  const neo4jError = error as Neo4jDriverError | undefined;
  const message = neo4jError?.message?.trim();
  const code = neo4jError?.code?.trim();

  if (code && message) {
    return `${code}: ${message}`;
  }

  if (message) {
    return message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Failed to connect to Neo4j';
}

function getHelpfulErrorHint(error: unknown): string | null {
  const neo4jError = error as Neo4jDriverError | undefined;
  const message = neo4jError?.message?.toLowerCase() ?? '';
  const code = neo4jError?.code ?? '';
  const combined = `${code} ${message}`;

  if (combined.includes('unauthorized') || combined.includes('authentication failure')) {
    return 'Check the Neo4j username and password, and make sure the selected database exists and that the user can access it.';
  }

  if (combined.includes('certificate') || combined.includes('ssl')) {
    return 'This can happen when the connection URL or TLS settings do not match the database endpoint. Aura usually requires a neo4j+s:// URL.';
  }

  if (combined.includes('websocket') || combined.includes('network') || combined.includes('serviceunavailable')) {
    return 'The browser could not reach the database. Confirm the Neo4j URL is correct and reachable from your network.';
  }

  return null;
}

const browserLogging = {
  level: 'debug' as const,
  logger: (level: string, message: string) => {
    const timestamp = new Date().toISOString();
    console.log(`[Neo4j ${level.toUpperCase()} ${timestamp}] ${message}`);
  },
};

export function Neo4jProvider({ children }: { children: React.ReactNode }) {
  const [driverInstance, setDriverInstance] = useState<Driver | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<ConnectionState>({
    isConnected: false,
    isConnecting: false,
    neo4jCredentials: null,
    openaiCredentials: null,
    error: null,
  });

  // Load saved credentials from localStorage on mount
  useEffect(() => {
    const savedUrl = localStorage.getItem(STORAGE_KEYS.NEO4J_URL);
    const savedDatabase = localStorage.getItem(STORAGE_KEYS.NEO4J_DATABASE);
    const savedUsername = localStorage.getItem(STORAGE_KEYS.NEO4J_USERNAME);
    const savedApiKey = localStorage.getItem(STORAGE_KEYS.OPENAI_API_KEY);

    if (savedUrl && savedDatabase && savedUsername) {
      setState(prev => ({
        ...prev,
        neo4jCredentials: {
          url: savedUrl,
          database: savedDatabase,
          username: savedUsername,
          password: '',
        },
        openaiCredentials: savedApiKey ? { apiKey: savedApiKey } : null,
      }));
    }
  }, []);

  const connect = useCallback(async (neo4j: Neo4jCredentials, openai: OpenAICredentials): Promise<boolean> => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Create driver instance with proper auth
      const newDriver = driver(
        neo4j.url,
        auth.basic(neo4j.username, neo4j.password),
        {
          logging: browserLogging,
        }
      );
      
      // Test connection
      await newDriver.verifyConnectivity();
      
      // Create session
      const newSession = newDriver.session({ database: neo4j.database });
      
      // Test with a simple query
      await newSession.run('RETURN 1 AS test');

      // Save credentials to localStorage (except password)
      localStorage.setItem(STORAGE_KEYS.NEO4J_URL, neo4j.url);
      localStorage.setItem(STORAGE_KEYS.NEO4J_DATABASE, neo4j.database);
      localStorage.setItem(STORAGE_KEYS.NEO4J_USERNAME, neo4j.username);
      localStorage.setItem(STORAGE_KEYS.OPENAI_API_KEY, openai.apiKey);

      setDriverInstance(newDriver);
      setSession(newSession);
      setState({
        isConnected: true,
        isConnecting: false,
        neo4jCredentials: neo4j,
        openaiCredentials: openai,
        error: null,
      });

      return true;
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      const helpfulHint = getHelpfulErrorHint(err);
      const composedMessage = helpfulHint ? `${errorMessage} ${helpfulHint}` : errorMessage;

      console.error('Neo4j connection failed', {
        attemptedUrl: neo4j.url,
        attemptedDatabase: neo4j.database,
        attemptedUsername: neo4j.username,
        error: serializeError(err),
      });

      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: composedMessage,
      }));
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (session) {
      session.close();
      setSession(null);
    }
    if (driverInstance) {
      driverInstance.close();
      setDriverInstance(null);
    }
    setState({
      isConnected: false,
      isConnecting: false,
      neo4jCredentials: null,
      openaiCredentials: null,
      error: null,
    });
  }, [session, driverInstance]);

  const reconnect = useCallback(() => {
    disconnect();
    // Clear stored credentials to force reconnection dialog
    localStorage.removeItem(STORAGE_KEYS.NEO4J_URL);
    localStorage.removeItem(STORAGE_KEYS.NEO4J_DATABASE);
    localStorage.removeItem(STORAGE_KEYS.NEO4J_USERNAME);
    localStorage.removeItem(STORAGE_KEYS.OPENAI_API_KEY);
    setState({
      isConnected: false,
      isConnecting: false,
      neo4jCredentials: null,
      openaiCredentials: null,
      error: null,
    });
  }, [disconnect]);

  const executeQuery = useCallback(async (query: string, parameters?: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
    if (!session) {
      throw new Error('No active session. Please connect to Neo4j first.');
    }
    
    const result = await session.run(query, parameters);
    return result.records.map(record => {
      const obj: Record<string, unknown> = {};
      for (const key of record.keys) {
        obj[key as string] = record.get(key);
      }
      return obj;
    });
  }, [session]);

  const getSession = useCallback(() => session, [session]);

  return (
    <Neo4jContext.Provider value={{
      ...state,
      connect,
      disconnect,
      reconnect,
      executeQuery,
      getSession,
    }}>
      {children}
    </Neo4jContext.Provider>
  );
}

export function useNeo4j(): Neo4jContextType {
  const context = useContext(Neo4jContext);
  if (!context) {
    throw new Error('useNeo4j must be used within a Neo4jProvider');
  }
  return context;
}
