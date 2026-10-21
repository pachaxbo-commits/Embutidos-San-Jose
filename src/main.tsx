import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { Capacitor } from '@capacitor/core'
import { initializePrinting } from './services/printing/printerBootstrap'

// Apply the saved palette before React mounts to avoid a light/dark flash.
try {
  document.documentElement.dataset.theme = localStorage.getItem('san-jose:theme:v1') === 'dark' ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}

// Registra los adaptadores de impresion reales y los perfiles guardados.
initializePrinting()

// Android dibuja la aplicacion debajo de las barras del sistema: se marca el
// documento para reservar el espacio de la barra de estado y la de navegacion.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('is-native-app')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
