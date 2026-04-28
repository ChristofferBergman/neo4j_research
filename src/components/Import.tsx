import { useMemo, useState } from 'react';
import {
  Box,
  CleanIconButton,
  FilledButton,
  Flex,
  OutlinedButton,
  TextArea,
  TextInput,
  Typography,
} from '@neo4j-ndl/react';
import {
  CloudArrowDownIconOutline,
  LinkIconOutline,
  PlayIconOutline,
  PlusIconOutline,
  SparklesIconOutline,
  TrashIconOutline,
} from '@neo4j-ndl/react/icons';
import { useNeo4j } from '../context/Neo4jContext';

interface ImportProps {
  className?: string;
}

interface SupportingUrl {
  id: number;
  value: string;
}

interface ImportPlan {
  cypher: string;
  description: string;
}

interface StatusMessage {
  tone: 'neutral' | 'info' | 'success' | 'error';
  text: string;
}

type OpenAIResponseOutputText = {
  type?: string;
  text?: string;
};

type OpenAIResponseOutputItem = {
  type?: string;
  content?: OpenAIResponseOutputText[];
};

type OpenAIResponse = {
  output?: OpenAIResponseOutputItem[];
  status?: string;
  incomplete_details?: {
    reason?: string;
  } | null;
  error?: {
    message?: string;
  } | null;
};

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = 'gpt-5.5';
const CSV_PREVIEW_BYTES = 20_000;
const CSV_PREVIEW_TIMEOUT_MS = 8_000;
const IMPORT_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cypher: {
      type: 'string',
      description: 'A single executable Neo4j Cypher statement using LOAD CSV WITH HEADERS from the supplied CSV URL.',
    },
    description: {
      type: 'string',
      description: 'A plain text explanation of the intended graph import and assumptions.',
    },
  },
  required: ['cypher', 'description'],
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}

function isImportPlan(value: unknown): value is ImportPlan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ImportPlan>;
  return typeof candidate.cypher === 'string' && typeof candidate.description === 'string';
}

function normalizeCypher(cypher: string): string {
  return cypher.trim().replace(/;+\s*$/, '');
}

function buildPromptPayload(
  csvUrl: string,
  supportingUrls: string[],
  dataDescription: string,
  csvPreview: string | null
): string {
  return JSON.stringify(
    {
      csvUrl,
      supportingPublicationUrls: supportingUrls,
      dataDescription,
      csvPreview: csvPreview ?? 'CSV preview was not available from the browser. Infer cautiously from the URL, supporting links, and description.',
    },
    null,
    2
  );
}

function getResponseOutputText(body: OpenAIResponse): string | null {
  const textParts = body.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text);

  if (!textParts || textParts.length === 0) {
    return null;
  }

  return textParts.join('\n');
}

async function readCsvPreview(csvUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CSV_PREVIEW_TIMEOUT_MS);

  try {
    const response = await fetch(csvUrl, { signal: controller.signal });

    if (!response.ok) {
      return null;
    }

    if (!response.body) {
      return (await response.text()).slice(0, CSV_PREVIEW_BYTES);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (totalLength < CSV_PREVIEW_BYTES) {
      const { done, value } = await reader.read();

      if (done || !value) {
        break;
      }

      chunks.push(value);
      totalLength += value.length;
    }

    await reader.cancel().catch(() => undefined);

    const bytes = new Uint8Array(Math.min(totalLength, CSV_PREVIEW_BYTES));
    let offset = 0;

    for (const chunk of chunks) {
      const remaining = bytes.length - offset;
      if (remaining <= 0) {
        break;
      }

      bytes.set(chunk.slice(0, remaining), offset);
      offset += Math.min(chunk.length, remaining);
    }

    return new TextDecoder().decode(bytes).split(/\r?\n/).slice(0, 40).join('\n');
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function createImportPlan(
  apiKey: string,
  csvUrl: string,
  supportingUrls: string[],
  dataDescription: string,
  csvPreview: string | null
): Promise<ImportPlan> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        'You are a Neo4j data-import assistant.',
        'Use web search to read the supplied supporting publication URLs when they are provided.',
        'Create exactly one executable Cypher statement that imports the CSV data with LOAD CSV WITH HEADERS from the supplied public CSV URL.',
        'Use clear labels, relationship types, and property names that fit the data description.',
        'Prefer MERGE when a stable identifier is evident; otherwise use CREATE.',
        'Always use CALL {} IN TRANSACTIONS to preserve memory.',
        'Keep this outer form of the import query: LOAD CSV WITH HEADERS FROM xxx AS row CALL(row) { ... } IN TRANSACTIONS OF 100 ROWS.',
        'Do not return anything from the import statement.',
        'Do not use APOC procedures. Do not wrap the Cypher in Markdown fences. Do not include a trailing semicolon.',
        'The description should explain the intended graph shape and key assumptions in plain language.',
      ].join(' '),
      input: buildPromptPayload(csvUrl, supportingUrls, dataDescription, csvPreview),
      tools: [{ type: 'web_search', search_context_size: 'high' }],
      tool_choice: supportingUrls.length > 0 ? 'required' : 'auto',
      include: ['web_search_call.action.sources'],
      text: {
        format: {
          name: 'neo4j_csv_import_plan',
          type: 'json_schema',
          strict: true,
          schema: IMPORT_PLAN_SCHEMA,
        },
      },
    }),
  });

  const body = (await response.json().catch(() => null)) as OpenAIResponse | null;

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `OpenAI request failed with status ${response.status}`);
  }

  if (!body) {
    throw new Error('OpenAI returned an empty response.');
  }

  if (body.status === 'incomplete') {
    throw new Error(`OpenAI response was incomplete: ${body.incomplete_details?.reason ?? 'unknown reason'}`);
  }

  const outputText = getResponseOutputText(body);

  if (!outputText) {
    throw new Error(body.error?.message ?? 'OpenAI returned no text output.');
  }

  const parsed = JSON.parse(outputText) as unknown;

  if (!isImportPlan(parsed)) {
    throw new Error('OpenAI returned an unexpected response shape.');
  }

  return {
    cypher: normalizeCypher(parsed.cypher),
    description: parsed.description.trim(),
  };
}

export function Import({ className }: ImportProps) {
  const { isConnected, getSession, openaiCredentials } = useNeo4j();
  const [csvUrl, setCsvUrl] = useState('');
  const [supportingUrls, setSupportingUrls] = useState<SupportingUrl[]>([]);
  const [dataDescription, setDataDescription] = useState('');
  const [importDescription, setImportDescription] = useState('');
  const [cypher, setCypher] = useState('');
  const [status, setStatus] = useState<StatusMessage>({ tone: 'neutral', text: 'Ready' });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const trimmedSupportingUrls = useMemo(
    () => supportingUrls.map((url) => url.value.trim()).filter(Boolean),
    [supportingUrls]
  );
  const trimmedCsvUrl = csvUrl.trim();
  const isBusy = isAnalyzing || isImporting;
  const canAnalyze = trimmedCsvUrl.length > 0 && !isBusy;
  const canImport = normalizeCypher(cypher).length > 0 && !isBusy;

  const addSupportingUrl = () => {
    setSupportingUrls((urls) => [...urls, { id: Date.now(), value: '' }]);
  };

  const updateSupportingUrl = (id: number, value: string) => {
    setSupportingUrls((urls) => urls.map((url) => (url.id === id ? { ...url, value } : url)));
  };

  const removeSupportingUrl = (id: number) => {
    setSupportingUrls((urls) => urls.filter((url) => url.id !== id));
  };

  const handleAnalyze = async () => {
    if (!trimmedCsvUrl) {
      setStatus({ tone: 'error', text: 'Error: Enter a public CSV URL first.' });
      return;
    }

    if (!openaiCredentials?.apiKey) {
      setStatus({ tone: 'error', text: 'Error: No OpenAI API key found. Reconnect and enter an API key.' });
      return;
    }

    setIsAnalyzing(true);
    setStatus({ tone: 'info', text: 'Analyzing...' });

    try {
      const csvPreview = await readCsvPreview(trimmedCsvUrl);
      const plan = await createImportPlan(
        openaiCredentials.apiKey,
        trimmedCsvUrl,
        trimmedSupportingUrls,
        dataDescription.trim(),
        csvPreview
      );

      setImportDescription(plan.description);
      setCypher(plan.cypher);
      setStatus({ tone: 'success', text: 'Analysis complete' });
    } catch (error) {
      setStatus({ tone: 'error', text: `Error: ${getErrorMessage(error, 'Analysis failed')}` });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImport = async () => {
    const session = getSession();
    const query = normalizeCypher(cypher);

    if (!session) {
      setStatus({ tone: 'error', text: 'Error: No active session. Please connect to Neo4j first.' });
      return;
    }

    if (!query) {
      setStatus({ tone: 'error', text: 'Error: Analyze the data or enter a Cypher import query first.' });
      return;
    }

    setIsImporting(true);
    setStatus({ tone: 'info', text: 'Importing...' });

    try {
      await session.run(query);
      setStatus({ tone: 'success', text: 'Successfully imported' });
    } catch (error) {
      setStatus({ tone: 'error', text: `Error: ${getErrorMessage(error, 'Import failed')}` });
    } finally {
      setIsImporting(false);
    }
  };

  if (!isConnected) {
    return (
      <div className={className} style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '48px',
      }}>
        <Flex gap="4" alignItems="center" flexDirection="column">
          <Typography variant="title-2">Not Connected</Typography>
          <Typography variant="body-medium" style={{ textAlign: 'center', maxWidth: '400px' }}>
            Please connect to a Neo4j database before importing data.
          </Typography>
        </Flex>
      </div>
    );
  }

  return (
    <Flex gap="4" className={className} style={{ height: '100%' }} flexDirection="column">
      <Box className="import-panel" padding="6" borderRadius="lg">
        <Flex gap="4" flexDirection="column">
          <Typography variant="title-2">Import Data</Typography>

          <TextInput
            label="CSV URL"
            placeholder="https://example.com/data.csv"
            value={csvUrl}
            onChange={(event) => setCsvUrl(event.target.value)}
            isFluid
            isRequired
            isDisabled={isBusy}
            leadingElement={<CloudArrowDownIconOutline />}
          />

          <Flex gap="4" flexDirection="column">
            <Flex gap="4" alignItems="center" justifyContent="space-between">
              <Typography variant="label">Supporting publication URLs</Typography>
              <OutlinedButton
                onClick={addSupportingUrl}
                isDisabled={isBusy}
                size="small"
                leadingVisual={<PlusIconOutline />}
              >
                Add URL
              </OutlinedButton>
            </Flex>

            {supportingUrls.map((url, index) => (
              <Flex key={url.id} gap="2" alignItems="flex-end">
                <TextInput
                  label={`Publication URL ${index + 1}`}
                  placeholder="https://example.com/paper"
                  value={url.value}
                  onChange={(event) => updateSupportingUrl(url.id, event.target.value)}
                  isFluid
                  isDisabled={isBusy}
                  leadingElement={<LinkIconOutline />}
                />
                <CleanIconButton
                  description={`Remove publication URL ${index + 1}`}
                  onClick={() => removeSupportingUrl(url.id)}
                  isDisabled={isBusy}
                  variant="danger"
                  size="medium"
                >
                  <TrashIconOutline />
                </CleanIconButton>
              </Flex>
            ))}
          </Flex>

          <TextArea
            label="Data description"
            placeholder="Describe entities, identifiers, relationships, column meanings, and anything important about the data."
            value={dataDescription}
            isFluid
            isDisabled={isBusy}
            htmlAttributes={{
              rows: 5,
              onChange: (event) => setDataDescription(event.target.value),
            }}
          />

          <Flex gap="4" justifyContent="flex-end" flexWrap="wrap">
            <FilledButton
              onClick={handleAnalyze}
              isLoading={isAnalyzing}
              isDisabled={!canAnalyze}
              leadingVisual={<SparklesIconOutline />}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </FilledButton>
          </Flex>

          <div className="import-output-grid">
            <TextArea
              label="Import description"
              placeholder="Analyze the CSV to generate an import description."
              value={importDescription}
              isFluid
              isDisabled={isBusy}
              htmlAttributes={{
                rows: 12,
                onChange: (event) => setImportDescription(event.target.value),
              }}
            />

            <TextArea
              label="Cypher import query"
              placeholder="Analyze the CSV to generate editable Cypher."
              value={cypher}
              isFluid
              isDisabled={isBusy}
              htmlAttributes={{
                rows: 12,
                spellCheck: false,
                onChange: (event) => setCypher(event.target.value),
              }}
              className="import-cypher-textarea"
            />
          </div>

          <Flex gap="4" justifyContent="flex-end" flexWrap="wrap">
            <FilledButton
              onClick={handleImport}
              isLoading={isImporting}
              isDisabled={!canImport}
              leadingVisual={<PlayIconOutline />}
              style={{ backgroundColor: '#10B981' }}
            >
              {isImporting ? 'Importing...' : 'Import'}
            </FilledButton>
          </Flex>

          <div className={`import-status import-status-${status.tone}`} aria-live="polite">
            <Typography variant="body-small">Status: {status.text}</Typography>
          </div>
        </Flex>
      </Box>
    </Flex>
  );
}
