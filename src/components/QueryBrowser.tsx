import React, { useMemo, useState } from 'react';
import type { Layout } from '@neo4j-nvl/base';
import {
  Divider,
  FilledButton,
  Flex,
  IconButtonArray,
  Typography,
} from '@neo4j-ndl/react';
import {
  GraphVisualization,
  type Gesture,
  type NeoNode,
  type NeoRel,
  type PortableProperty,
} from '@neo4j-ndl/react-graph';
import type {
  Node as DriverNode,
  Path as DriverPath,
  Record as Neo4jRecord,
  Relationship as DriverRelationship,
  Session,
} from 'neo4j-driver';
import { useNeo4j } from '../context/Neo4jContext';

interface QueryBrowserProps {
  className?: string;
}

interface GraphQueryResult {
  nodes: NeoNode[];
  rels: NeoRel[];
  records: Record<string, unknown>[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeLike(value: unknown): value is DriverNode {
  return isObject(value) && 'labels' in value && Array.isArray((value as { labels?: unknown }).labels);
}

function isRelationshipLike(value: unknown): value is DriverRelationship {
  return (
    isObject(value) &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string' &&
    'startNodeElementId' in value
  );
}

function isPathLike(value: unknown): value is DriverPath {
  return isObject(value) && 'segments' in value && Array.isArray((value as { segments?: unknown }).segments);
}

function toPortableProperties(properties: Record<string, unknown> = {}): Record<string, PortableProperty> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      const type =
        value === null ? 'null' :
        Array.isArray(value) ? 'array' :
        typeof value;

      const stringified =
        typeof value === 'string' ? `"${value}"` :
        value === undefined ? 'undefined' :
        JSON.stringify(value) ?? String(value);

      return [key, { stringified, type }];
    })
  );
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

function nodeCaption(node: DriverNode): string {
  const labels = node.labels.length > 0 ? node.labels.join(': ') : 'Node';
  const preferredKeys = ['name', 'title', 'id', 'uuid'];

  for (const key of preferredKeys) {
    const value = node.properties[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return `${labels}: ${String(value)}`;
    }
  }

  const firstProperty = Object.values(node.properties).find((value) => value !== undefined && value !== null);
  return firstProperty !== undefined ? `${labels}: ${String(firstProperty)}` : labels;
}

function extractGraphElements(
  value: unknown,
  nodesById: Map<string, NeoNode>,
  relsById: Map<string, NeoRel>
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => extractGraphElements(item, nodesById, relsById));
    return;
  }

  if (isPathLike(value)) {
    value.segments.forEach((segment) => {
      extractGraphElements(segment.start, nodesById, relsById);
      extractGraphElements(segment.relationship, nodesById, relsById);
      extractGraphElements(segment.end, nodesById, relsById);
    });
    return;
  }

  if (isNodeLike(value)) {
    const id = toId(value.elementId ?? value.identity, `node-${nodesById.size}`);
    if (!nodesById.has(id)) {
      nodesById.set(id, {
        id,
        caption: nodeCaption(value),
        labels: value.labels,
        properties: toPortableProperties(value.properties),
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

    const id = toId(value.elementId ?? value.identity, `rel-${relsById.size}`);
    if (!relsById.has(id)) {
      relsById.set(id, {
        id,
        from,
        to,
        type: value.type,
        caption: value.type,
        properties: toPortableProperties(value.properties),
      });
    }
  }
}

function toTableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toTableValue(item));
  }

  if (isNodeLike(value)) {
    return {
      id: toId(value.elementId ?? value.identity, ''),
      labels: value.labels,
      properties: value.properties,
    };
  }

  if (isRelationshipLike(value)) {
    return {
      id: toId(value.elementId ?? value.identity, ''),
      type: value.type,
      from: toId(value.startNodeElementId ?? value.start, ''),
      to: toId(value.endNodeElementId ?? value.end, ''),
      properties: value.properties,
    };
  }

  if (isPathLike(value)) {
    return {
      length: value.length,
      segments: value.segments.map((segment) => ({
        start: toTableValue(segment.start),
        relationship: toTableValue(segment.relationship),
        end: toTableValue(segment.end),
      })),
    };
  }

  if (isObject(value) && typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
    return value.toString();
  }

  return value;
}

function buildGraphQueryResult(records: Neo4jRecord[]): GraphQueryResult {
  const nodesById = new Map<string, NeoNode>();
  const relsById = new Map<string, NeoRel>();

  const tableRecords = records.map((record) => {
    const row: Record<string, unknown> = {};

    record.keys.forEach((key) => {
      const value = record.get(key);
      row[String(key)] = toTableValue(value);
      extractGraphElements(value, nodesById, relsById);
    });

    return row;
  });

  const nodes = Array.from(nodesById.values());
  const rels = Array.from(relsById.values()).filter((rel) => nodesById.has(rel.from) && nodesById.has(rel.to));

  return { nodes, rels, records: tableRecords };
}

class GraphErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('GraphVisualization crashed', error);
  }

  componentDidUpdate(prevProps: { children: React.ReactNode }) {
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-message">
          Graph rendering failed for this result set. Try a simpler query or switch to the table view.
        </div>
      );
    }

    return this.props.children;
  }
}

async function runGraphQuery(session: Session, query: string): Promise<GraphQueryResult> {
  const result = await session.run(query);
  return buildGraphQueryResult(result.records);
}

export function QueryBrowser({ className }: QueryBrowserProps) {
  const { isConnected, getSession } = useNeo4j();
  const [query, setQuery] = useState('MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN *');
  const [graphData, setGraphData] = useState<GraphQueryResult | null>(null);
  const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const [gesture, setGesture] = useState<Gesture>('single');
  const [layout, setLayout] = useState<Layout>('forceDirected');
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [sidePanelWidth, setSidePanelWidth] = useState(320);

  const graphStats = useMemo(() => ({
    nodes: graphData?.nodes.length ?? 0,
    rels: graphData?.rels.length ?? 0,
  }), [graphData]);

  const handleExecute = async () => {
    if (!query.trim()) return;

    const session = getSession();
    if (!session) {
      setError('No active session. Please connect to Neo4j first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await runGraphQuery(session, query);
      setGraphData(result);
      setTableData(result.records);

      if (result.nodes.length > 0) {
        setViewMode('graph');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query execution failed');
      setGraphData(null);
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
      <div style={{
        backgroundColor: 'var(--ndl-color-bg-subtle, #f9fafb)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <Flex gap="4" flexDirection="column">
          <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Typography variant="label">Cypher Query</Typography>
            <textarea
              value={query}
              placeholder="MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 25"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void handleExecute();
                }
              }}
              rows={4}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--ndl-color-border-subtle, #d1d5db)',
                backgroundColor: 'white',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '14px',
                resize: 'vertical',
              }}
            />
          </label>

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
        <div className="error-message">
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
            {graphStats.nodes} nodes, {graphStats.rels} relationships
          </Typography>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {viewMode === 'graph' ? (
            graphData && graphData.nodes.length > 0 ? (
              <GraphErrorBoundary>
                <div className="nvl-container" style={{ height: '100%', minHeight: '480px' }}>
                  <GraphVisualization
                    key={`${query}-${graphStats.nodes}-${graphStats.rels}`}
                    nodes={graphData.nodes}
                    rels={graphData.rels}
                    gesture={gesture}
                    setGesture={setGesture}
                    layout={layout}
                    setLayout={setLayout}
                    nvlOptions={{
                      minZoom: 0,
                      maxZoom: 1000,
                      disableWebWorkers: true,
                      disableTelemetry: true,
                    }}
                    sidepanel={{
                      isSidePanelOpen: sidePanelOpen,
                      setIsSidePanelOpen: setSidePanelOpen,
                      sidePanelWidth,
                      onSidePanelResize: setSidePanelWidth,
                      children: <GraphVisualization.SingleSelectionSidePanelContents />,
                    }}
                    topLeftIsland={<GraphVisualization.DownloadButton tooltipPlacement="right" />}
                    topRightIsland={<GraphVisualization.ToggleSidePanelButton tooltipPlacement="left" />}
                    bottomRightIsland={
                      <IconButtonArray size="medium" orientation="horizontal">
                        <GraphVisualization.GestureSelectButton menuPlacement="top-end-bottom-end" tooltipPlacement="top" />
                        <Divider orientation="vertical" />
                        <GraphVisualization.ZoomInButton tooltipPlacement="top" />
                        <GraphVisualization.ZoomOutButton tooltipPlacement="top" />
                        <GraphVisualization.ZoomToFitButton tooltipPlacement="top" />
                        <Divider orientation="vertical" />
                        <GraphVisualization.LayoutSelectButton menuPlacement="top-end-bottom-end" tooltipPlacement="top" />
                      </IconButtonArray>
                    }
                    style={{ height: '100%', width: '100%' }}
                  />
                </div>
              </GraphErrorBoundary>
            ) : (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--ndl-color-text-subtle, #6b7280)',
                border: '1px solid var(--ndl-color-border-subtle, #e5e7eb)',
                borderRadius: '8px',
              }}>
                <Typography variant="body-medium">
                  {tableData.length > 0 ? 'This query returned rows, but no graph-shaped values for visualization.' : 'Run a query to see results'}
                </Typography>
              </div>
            )
          ) : (
            tableData.length > 0 ? (
              <div style={{ overflow: 'auto', height: '100%', border: '1px solid var(--ndl-color-border-subtle, #e5e7eb)', borderRadius: '8px' }}>
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
                            borderBottom: '1px solid var(--ndl-color-border-subtle, #e5e7eb)',
                            verticalAlign: 'top',
                            whiteSpace: 'pre-wrap'
                          }}>
                            {typeof value === 'object'
                              ? JSON.stringify(value, null, 2)
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
