import React, { useState, useCallback } from 'react';
import {
  TextArea,
  FilledButton,
  Flex,
  Typography,
} from '@neo4j-ndl/react';
import { useNeo4j } from '../context/Neo4jContext';
import { InteractiveNvlWrapper } from '@neo4j-nvl/react';
import type { Node, Relationship } from '@neo4j-nvl/base';

interface QueryBrowserProps {
  className?: string;
}

interface NVLGraphData {
  nodes: Node[];
  relationships: Relationship[];
}

export function QueryBrowser({ className }: QueryBrowserProps) {
  const { executeQuery, isConnected } = useNeo4j();
  const [query, setQuery] = useState('MATCH (n) RETURN n LIMIT 25');
  const [results, setResults] = useState<NVLGraphData | null>(null);
  const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');

  const convertToNVLData = useCallback((records: Record<string, unknown>[]): NVLGraphData => {
    const nodes: Node[] = [];
    const relationships: Relationship[] = [];
    const nodeMap = new Map<string, string>();

    records.forEach((record, recordIndex) => {
      Object.values(record).forEach((value) => {
        if (value && typeof value === 'object') {
          const obj = value as { labels?: string[]; type?: string; start?: unknown; end?: unknown; identity?: unknown; properties?: Record<string, unknown> };
          
          // Check if it's a node
          if (obj.labels && Array.isArray(obj.labels)) {
            const nodeId = `node_${nodeMap.size}_${recordIndex}`;
            const key = JSON.stringify(obj.properties);
            const existingId = nodeMap.get(key);
            
            if (existingId === undefined) {
              nodeMap.set(key, nodeId);
              nodes.push({
                id: nodeId,
                caption: obj.labels.join(': ') + (obj.properties ? ` (${JSON.stringify(obj.properties).slice(1, -1)})` : ''),
              });
            }
          }
          
          // Check if it's a relationship
          if (obj.type && obj.start && obj.end) {
            relationships.push({
              id: `rel_${relationships.length}`,
              from: `node_${recordIndex}_source`,
              to: `node_${recordIndex}_target`,
              type: obj.type as string,
            });
          }
        }
      });
    });

    return { nodes, relationships };
  }, []);

  const handleExecute = async () => {
    if (!query.trim()) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const records = await executeQuery(query);
      
      if (records && records.length > 0) {
        // Try to convert to graph data
        try {
          const nvlData = convertToNVLData(records);
          if (nvlData.nodes.length > 0 || nvlData.relationships.length > 0) {
            setResults(nvlData);
            setViewMode('graph');
          } else {
            setResults(null);
          }
        } catch {
          setResults(null);
        }
        
        // Also show table data
        setTableData(records);
      } else {
        setResults(null);
        setTableData([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query execution failed');
      setResults(null);
      setTableData([]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className={className} style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100%',
        padding: '48px'
      }}>
        <Flex gap="4" alignItems="center" flexDirection="column">
          <Typography variant="title-2">Not Connected</Typography>
          <Typography variant="body-medium" style={{ textAlign: 'center', maxWidth: '400px' }}>
            Please connect to a Neo4j database to start running queries.
          </Typography>
        </Flex>
      </div>
    );
  }

  return (
    <Flex gap="4" className={className} style={{ height: '100%' }} flexDirection="column">
      {/* Query Input Area */}
      <div style={{ 
        backgroundColor: 'var(--ndl-color-bg-subtle, #f9fafb)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <Flex gap="4" flexDirection="column">
          <TextArea
            label="Cypher Query"
            value={query}
            placeholder="MATCH (n) RETURN n LIMIT 25"
            style={{ fontFamily: 'monospace' }}
            htmlAttributes={{
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value),
              rows: 3
            }}
          />
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body-small" style={{ color: 'var(--ndl-color-text-subtle, #6b7280)' }}>
              Press Ctrl+Enter to execute
            </Typography>
            <FilledButton
              onClick={handleExecute}
              isLoading={isLoading}
              isDisabled={isLoading || !query.trim()}
            >
              Run Query
            </FilledButton>
          </div>
        </Flex>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ 
          padding: '12px 16px', 
          backgroundColor: 'var(--ndl-color-bg-danger-subtle, #fef2f2)',
          borderRadius: '8px',
          color: 'var(--ndl-color-text-danger, #dc2626)'
        }}>
          <Typography variant="body-small">{error}</Typography>
        </div>
      )}

      {/* Results Area */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          marginBottom: '12px',
          borderBottom: '1px solid var(--ndl-color-border-subtle, #e5e7eb)',
          paddingBottom: '8px'
        }}>
          <FilledButton
            onClick={() => setViewMode('graph')}
            variant={viewMode === 'graph' ? 'primary' : 'danger'}
            size="small"
          >
            Graph View
          </FilledButton>
          <FilledButton
            onClick={() => setViewMode('table')}
            variant={viewMode === 'table' ? 'primary' : 'danger'}
            size="small"
          >
            Table View ({tableData.length} records)
          </FilledButton>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {viewMode === 'graph' ? (
            results && (results.nodes.length > 0 || results.relationships.length > 0) ? (
              <div style={{ height: '100%', minHeight: '400px' }}>
                <InteractiveNvlWrapper
                  nodes={results.nodes}
                  rels={results.relationships}
                  layout="forceDirected"
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            ) : (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                height: '100%',
                color: 'var(--ndl-color-text-subtle, #6b7280)'
              }}>
                <Typography variant="body-medium">
                  {tableData.length > 0 ? 'No graph data to display' : 'Run a query to see results'}
                </Typography>
              </div>
            )
          ) : (
            tableData.length > 0 ? (
              <div style={{ overflow: 'auto' }}>
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse',
                  fontSize: '14px'
                }}>
                  <thead>
                    <tr>
                      {Object.keys(tableData[0] || {}).map((key) => (
                        <th key={key} style={{ 
                          textAlign: 'left',
                          padding: '12px 8px',
                          borderBottom: '2px solid var(--ndl-color-border-subtle, #e5e7eb)',
                          fontWeight: 600,
                          backgroundColor: 'var(--ndl-color-bg-subtle, #f9fafb)'
                        }}>
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((row, idx) => (
                      <tr key={idx}>
                        {Object.values(row).map((value, vidx) => (
                          <td key={vidx} style={{ 
                            padding: '10px 8px',
                            borderBottom: '1px solid var(--ndl-color-border-subtle, #e5e7eb)'
                          }}>
                            {typeof value === 'object' 
                              ? JSON.stringify(value) 
                              : String(value ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                height: '100%',
                color: 'var(--ndl-color-text-subtle, #6b7280)'
              }}>
                <Typography variant="body-medium">
                  Run a query to see results
                </Typography>
              </div>
            )
          )}
        </div>
      </div>
    </Flex>
  );
}