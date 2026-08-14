import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initializePrinting } from './services/printing/printerBootstrap'

// Registra los adaptadores de impresion reales y los perfiles guardados.
initializePrinting()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
