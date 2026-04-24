import React, { useCallback, useMemo, useState } from 'react';
import {
  TextArea,
  FilledButton,
  Flex,
  Typography,
} from '@neo4j-ndl/react';
import { InteractiveNvlWrapper } from '@neo4j-nvl/react';
import type { Node, Relationship } from '@neo4j-nvl/base';
import { useNeo4j } from '../context/Neo4jContext';

interface QueryBrowserProps {
  className?: string;
}

interface NVLGraphData {
  nodes: Node[];
  relationships: Relationship[];
}

type GraphEntity = {
  elementId?: string;
  identity?: { toString?: () => string } | string | number;
  labels?: string[];
  properties?: Record<string, unknown>;
  type?: string;
  startNodeElementId?: string;
  endNodeElementId?: string;
  start?: { toString?: () => string } | string | number;
  end?: { toString?: () => string } | string | number;
  segments?: Array<{
    start: GraphEntity;
    relationship: GraphEntity;
    end: GraphEntity;
  }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeLike(value: unknown): value is GraphEntity {
  return isObject(value) && Array.isArray((value as GraphEntity).labels);
}

function isRelationshipLike(value: unknown): value is GraphEntity {
  return isObject(value) && typeof (value as GraphEntity).type === 'string';
}

function isPathLike(value: unknown): value is GraphEntity {
  return isObject(value) && Array.isArray((value as GraphEntity).segments);
}

function toId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (isObject(value) && typeof value.toString === 'function') {
    const candidate = value.toString();
    if (candidate && candidate !== '[object Object]') {
      return candidate;
    }
  }

  return fallback;
}

function toNodeId(node: GraphEntity, fallback: string): string {
  return toId(node.elementId ?? node.identity, fallback);
}

function toRelationshipId(relationship: GraphEntity, fallback: string): string {
  return toId(relationship.elementId ?? relationship.identity, fallback);
}

function formatNodeCaption(node: GraphEntity): string {
  const labels = Array.isArray(node.labels) && node.labels.length > 0 ? node.labels.join(': ') : 'Node';
  const properties = node.properties ?? {};
  const preferredKeys = ['name', 'title', 'id', 'uuid'];

  for (const key of preferredKeys) {
    const value = properties[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return `${labels}: ${String(value)}`;
    }
  }

  const firstProperty = Object.entries(properties).find(([, value]) => value !== undefined && value !== null);
  if (firstProperty) {
    return `${labels}: ${String(firstProperty[1])}`;
  }

  return labels;
}

function collectGraphElements(
  value: unknown,
  nodesById: Map<string, Node>,
  relationshipsById: Map<string, Relationship>
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectGraphElements(item, nodesById, relationshipsById));
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (isPathLike(value)) {
    value.segments?.forEach((segment, index) => {
      collectGraphElements(segment.start, nodesById, relationshipsById);
      collectGraphElements(segment.end, nodesById, relationshipsById);
      collectGraphElements(segment.relationship ?? { ...segment, type: `PATH_${index}` }, nodesById, relationshipsById);
    });
    return;
  }

  if (isNodeLike(value)) {
    const id = toNodeId(value, `node-${nodesById.size}`);
    if (!nodesById.has(id)) {
      nodesById.set(id, {
        id,
        caption: formatNodeCaption(value),
      });
    }
    return;
  }

  if (isRelationshipLike(value)) {
    const from = toId(value.startNodeElementId ?? value.start, '');
    const to = toId(value.endNodeElementId ?? value.end, '');

    if (!from || !to) {
      return;
    }

    const id = toRelationshipId(value, `rel-${relationshipsById.size}`);
    if (!relationshipsById.has(id)) {
      relationshipsById.set(id, {
        id,
        from,
        to,
        caption: value.type,
      });
    }
  }
}

function convertToNVLData(records: Record<string, unknown>[]): NVLGraphData {
  const nodesById = new Map<string, Node>();
  const relationshipsById = new Map<string, Relationship>();

  records.forEach((record) => {
    Object.values(record).forEach((value) => {
      collectGraphElements(value, nodesById, relationshipsById);
    });
  });

  const validRelationships = Array.from(relationshipsById.values()).filter((relationship) => {
    return nodesById.has(relationship.from) && nodesById.has(relationship.to);
  });

  return {
    nodes: Array.from(nodesById.values()),
    relationships: validRelationships,
  };
}

export function QueryBrowser({ className }: QueryBrowserProps) {
  const { executeQuery, isConnected } = useNeo4j();
  const [query, setQuery] = useState('MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 25');
  const [results, setResults] = useState<NVLGraphData | null>(null);
  const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const [graphMessage, setGraphMessage] = useState<string>('Graph ready');

  const graphSummary = useMemo(() => {
    return {
      nodes: results?.nodes.length ?? 0,
      relationships: results?.relationships.length ?? 0,
    };
  }, [results]);

  const handleExecute = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);
    setGraphMessage('Running query...');

    try {
      const records = await executeQuery(query);
      setTableData(records);

      if (records.length === 0) {
        setResults(null);
        setGraphMessage('Query returned no records');
        return;
      }

      const nvlData = convertToNVLData(records);
      if (nvlData.nodes.length === 0) {
        setResults(null);
        setGraphMessage('Query returned records, but no graph-shaped values for NVL');
        return;
      }

      setResults(nvlData);
      setViewMode('graph');
      setGraphMessage(`Loaded ${nvlData.nodes.length} nodes and ${nvlData.relationships.length} relationships`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query execution failed');
      setResults(null);
      setTableData([]);
      setGraphMessage('Graph failed to load');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQueryKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleExecute();
    }
  }, [query]);

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
      <div style={{
        backgroundColor: 'var(--ndl-color-bg-subtle, #f9fafb)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <Flex gap="4" flexDirection="column">
          <TextArea
            label="Cypher Query"
            value={query}
            placeholder="MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 25"
            style={{ fontFamily: 'monospace' }}
            htmlAttributes={{
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value),
              onKeyDown: handleQueryKeyDown,
              rows: 3
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body-small" style={{ color: 'var(--ndl-color-text-subtle, #6b7280)' }}>
              Press Ctrl+Enter or Cmd+Enter to execute
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

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '12px',
          borderBottom: '1px solid var(--ndl-color-border-subtle, #e5e7eb)',
          paddingBottom: '8px',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
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

          <Typography variant="body-small" style={{ color: 'var(--ndl-color-text-subtle, #6b7280)' }}>
            {graphSummary.nodes} nodes, {graphSummary.relationships} relationships. {graphMessage}
          </Typography>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {viewMode === 'graph' ? (
            results && results.nodes.length > 0 ? (
              <div style={{ height: '100%', minHeight: '400px', borderRadius: '8px', overflow: 'hidden' }}>
                <InteractiveNvlWrapper
                  key={`${graphSummary.nodes}-${graphSummary.relationships}-${query}`}
                  nodes={results.nodes}
                  rels={results.relationships}
                  layout="forceDirected"
                  nvlOptions={{
                    disableTelemetry: true,
                    initialZoom: 0.85,
                  }}
                  interactionOptions={{
                    selectOnClick: true,
                    selectOnRelease: true,
                  }}
                  mouseEventCallbacks={{
                    onPan: true,
                    onZoom: true,
                    onNodeClick: (node) => setGraphMessage(`Selected node ${node.caption ?? node.id}`),
                    onRelationshipClick: (relationship) => setGraphMessage(`Selected relationship ${relationship.caption ?? relationship.id}`),
                    onCanvasClick: () => setGraphMessage(`Loaded ${graphSummary.nodes} nodes and ${graphSummary.relationships} relationships`),
                  }}
                  nvlCallbacks={{
                    onLayoutDone: () => setGraphMessage(`Layout complete: ${graphSummary.nodes} nodes, ${graphSummary.relationships} relationships`),
                  }}
                  onInitializationError={(initializationError) => {
                    console.error('NVL initialization failed', initializationError);
                    setGraphMessage('NVL initialization failed');
                  }}
                  style={{ height: '100%', width: '100%', background: 'white' }}
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
