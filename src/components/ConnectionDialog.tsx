import { useState, useEffect } from 'react';
import {
  Dialog,
  TextInput,
  FilledButton,
  Flex,
  Typography,
} from '@neo4j-ndl/react';
import { useNeo4j } from '../context/Neo4jContext';

interface ConnectionDialogProps {
  open: boolean;
  onClose?: () => void;
}

export function ConnectionDialog({ open, onClose }: ConnectionDialogProps) {
  const { connect, isConnecting, error } = useNeo4j();
  
  const [url, setUrl] = useState('neo4j+s://');
  const [database, setDatabase] = useState('neo4j');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Load saved values from context
  useEffect(() => {
    const savedUrl = localStorage.getItem('neo4j_research_url');
    const savedDatabase = localStorage.getItem('neo4j_research_database');
    const savedUsername = localStorage.getItem('neo4j_research_username');
    const savedApiKey = localStorage.getItem('neo4j_research_openai_key');
    
    if (savedUrl) setUrl(savedUrl);
    if (savedDatabase) setDatabase(savedDatabase);
    if (savedUsername) setUsername(savedUsername);
    if (savedApiKey) setApiKey(savedApiKey);
  }, []);

  const handleConnect = async () => {
    setLocalError(null);
    
    if (!url || !database || !username || !password || !apiKey) {
      setLocalError('All fields are required');
      return;
    }

    const success = await connect(
      { url, database, username, password },
      { apiKey }
    );

    if (success && onClose) {
      onClose();
    }
  };

  return (
    <Dialog 
      onClose={onClose}
      size="large"
      aria-labelledby="connection-dialog-title"
      isOpen={open}
      style={{ maxHeight: '90vh', overflowY: 'auto' }}
    >
      <Dialog.Header>
        <Typography variant="title-2">
          Connect to Neo4j
        </Typography>
      </Dialog.Header>
      
      <Dialog.Description>
        <Typography variant="body-medium">
          Enter your Neo4j database credentials and OpenAI API key to get started.
        </Typography>
      </Dialog.Description>
        
      {(error || localError) && (
        <div style={{ 
          padding: '12px 16px', 
          backgroundColor: 'var(--ndl-color-bg-danger-subtle, #fef2f2)',
          borderRadius: '8px',
          color: 'var(--ndl-color-text-danger, #dc2626)'
        }}>
          <Typography variant="body-small">
            {localError || error}
          </Typography>
        </div>
      )}

      <Dialog.Content>
        <Flex flexDirection="column" gap="4">
          <TextInput
            label="Neo4j URL"
            placeholder="neo4j+s://<INSTANCEID>.databases.neo4j.io"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            helpText="Example: neo4j+s://my-instance.databases.neo4j.io"
          />
          
          <TextInput
            label="Database"
            placeholder="neo4j"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            helpText="Usually 'neo4j' for Aura databases"
          />
          
          <TextInput
            label="Username"
            placeholder="neo4j"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          
          <TextInput
            label="Password"
            placeholder="Enter your Neo4j password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helpText="Your password will not be stored in the browser"
            htmlAttributes={{ type: 'password' }}
          />
          
          <TextInput
            label="OpenAI API Key"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            helpText="Required for AI-powered query generation"
            htmlAttributes={{ type: 'password' }}
          />
        </Flex>

        <Flex flexDirection="row" gap="4" justifyContent="flex-end" style={{ marginTop: '24px' }}>
          <FilledButton
            onClick={onClose}
            style={{ backgroundColor: '#f3f4f6', color: '#374151' }}
          >
            Cancel
          </FilledButton>
          <FilledButton
            onClick={handleConnect}
            isLoading={isConnecting}
            isDisabled={isConnecting}
            variant="primary"
            style={{ backgroundColor: '#018BFF' }}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </FilledButton>
        </Flex>
      </Dialog.Content>
    </Dialog>
  );
}