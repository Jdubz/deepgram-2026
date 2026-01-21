import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ProviderProvider, JobQueueProvider } from './contexts'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProviderProvider>
      <JobQueueProvider>
        <App />
      </JobQueueProvider>
    </ProviderProvider>
  </React.StrictMode>,
)
