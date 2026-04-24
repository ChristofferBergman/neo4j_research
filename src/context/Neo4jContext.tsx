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
        auth.basic(neo4j.username, neo4j.password)
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
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to Neo4j';
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: errorMessage,
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