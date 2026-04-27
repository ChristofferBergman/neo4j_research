import { useState, useEffect } from 'react';
import { Neo4jProvider, useNeo4j } from './context/Neo4jContext';
import { ConnectionDialog } from './components/ConnectionDialog';
import { QueryBrowser } from './components/QueryBrowser';
import {
  Flex,
  FilledButton,
  NeedleThemeProvider,
  Typography,
  SideNavigation,
  Box,
} from '@neo4j-ndl/react';
import './App.css';

function AppContent() {
  const { isConnected, reconnect, neo4jCredentials } = useNeo4j();
  const [showConnectionDialog, setShowConnectionDialog] = useState(!isConnected);
  const [activeView, setActiveView] = useState('query');

  useEffect(() => {
    if (!isConnected) {
      setShowConnectionDialog(true);
    }
  }, [isConnected]);

  const handleReconnect = () => {
    reconnect();
    setShowConnectionDialog(true);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <Flex flexDirection="row" gap="4" alignItems="center" style={{ width: '100%' }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="12" fill="#018BFF"/>
            <circle cx="16" cy="8" r="3" fill="white"/>
            <circle cx="8" cy="20" r="3" fill="white"/>
            <circle cx="24" cy="20" r="3" fill="white"/>
            <line x1="16" y1="11" x2="9" y2="18" stroke="white" strokeWidth="1.5"/>
            <line x1="16" y1="11" x2="23" y2="18" stroke="white" strokeWidth="1.5"/>
            <line x1="10" y1="20" x2="22" y2="20" stroke="white" strokeWidth="1.5"/>
          </svg>
          <Typography variant="title-1" style={{ fontWeight: 600 }}>
            Neo4j Research Assistant
          </Typography>
          
          {!isConnected ? (
            <FilledButton
              onClick={() => setShowConnectionDialog(true)}
              variant="primary"
              style={{ marginLeft: 'auto', backgroundColor: '#018BFF' }}
            >
              Connect to Neo4j
            </FilledButton>
          ) : (
            <Flex flexDirection="row" gap="4" alignItems="center" style={{ marginLeft: 'auto' }}>
              <Typography variant="body-small" style={{ color: 'rgba(255,255,255,0.8)' }}>
                Connected to {neo4jCredentials?.database} @ {neo4jCredentials?.url}
              </Typography>
              <FilledButton
                onClick={handleReconnect}
                variant="primary"
                style={{ color: 'white', borderColor: 'white' }}
              >
                Reconnect
              </FilledButton>
            </Flex>
          )}
        </Flex>
      </header>

      <div className="app-main">
        <nav className="app-sidebar">
          <SideNavigation ariaLabel="Main navigation">
            <SideNavigation.NavItem 
              onClick={() => setActiveView('query')}
              isActive={activeView === 'query'}
              label="Query Browser"
            />
            <SideNavigation.NavItem 
              onClick={() => setActiveView('import')}
              isActive={activeView === 'import'}
              label="Import Data"
            />
            <SideNavigation.NavItem 
              onClick={() => setActiveView('analysis')}
              isActive={activeView === 'analysis'}
              label="Analysis Tools"
            />
            <SideNavigation.NavItem 
              onClick={() => setActiveView('ai')}
              isActive={activeView === 'ai'}
              label="AI Query Assistant"
            />
          </SideNavigation>
        </nav>

        <main className="app-content">
          {activeView === 'query' && <QueryBrowser />}
          {activeView === 'import' && (
            <Box style={{ padding: '48px', textAlign: 'center' }}>
              <Typography variant="title-2">Import Data</Typography>
              <Typography variant="body-medium" style={{ marginTop: '16px', color: 'var(--ndl-color-text-subtle)' }}>
                CSV import tools coming soon...
              </Typography>
            </Box>
          )}
          {activeView === 'analysis' && (
            <Box style={{ padding: '48px', textAlign: 'center' }}>
              <Typography variant="title-2">Analysis Tools</Typography>
              <Typography variant="body-medium" style={{ marginTop: '16px', color: 'var(--ndl-color-text-subtle)' }}>
                Analysis tools coming soon...
              </Typography>
            </Box>
          )}
          {activeView === 'ai' && (
            <Box style={{ padding: '48px', textAlign: 'center' }}>
              <Typography variant="title-2">AI Query Assistant</Typography>
              <Typography variant="body-medium" style={{ marginTop: '16px', color: 'var(--ndl-color-text-subtle)' }}>
                AI-powered query generation coming soon...
              </Typography>
            </Box>
          )}
        </main>
      </div>

      <ConnectionDialog 
        open={showConnectionDialog} 
        onClose={() => setShowConnectionDialog(false)}
      />
    </div>
  );
}

function App() {
  return (
    <NeedleThemeProvider theme="light" wrapperProps={{ isWrappingChildren: false }}>
      <Neo4jProvider>
        <AppContent />
      </Neo4jProvider>
    </NeedleThemeProvider>
  );
}

export default App;
