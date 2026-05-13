import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'bootstrap/dist/css/bootstrap.min.css';
// Order matters: theme.css defines tokens, glass.css consumes them, index.css
// applies base typography + component rules using the same tokens.
import './theme.css'
import './glass.css'
import './index.css'
import App from './App.jsx'
import { registerServiceWorker, isPushSupported } from './utils/push'

if (isPushSupported()) registerServiceWorker().catch(() => {});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
