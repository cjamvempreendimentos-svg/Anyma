import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AuthGate from './components/AuthGate'
import './styles.css'
import './branding.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>{(workspace) => <App workspace={workspace} />}</AuthGate>
  </React.StrictMode>,
)
