/**
 * Carga firebase/firestore.rules en el emulador en caliente.
 * Util durante la validacion: no toca produccion.
 *
 *   npm run rules:load
 */
import fs from 'fs'

const HOST = 'http://127.0.0.1:8085'
const PROJECT_ID = 'pachax-flow'

const content = fs.readFileSync('firebase/firestore.rules', 'utf8')

const response = await fetch(`${HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
})

if (!response.ok) {
  console.error('No se pudieron cargar las reglas:', response.status, await response.text())
  process.exitCode = 1
} else {
  console.log('Reglas cargadas en el emulador.')
}
