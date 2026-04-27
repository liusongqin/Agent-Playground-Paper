import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'highlight.js/styles/vs2015.min.css'
import App from './App.jsx'
import { installFetchInterceptor } from './utils/apiMonitor'

// Install global fetch interceptor for developer monitoring
installFetchInterceptor();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
