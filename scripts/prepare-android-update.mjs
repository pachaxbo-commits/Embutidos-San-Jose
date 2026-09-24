import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const EXPECTED_PACKAGE = 'com.pachax.flow'
const LAST_DISTRIBUTED_VERSION_CODE = 19
const HOSTING_ROOT = resolve('dist', 'updates', 'san-jose')
const RELEASE_ROOT = resolve('output', 'android')

const options = parseArguments(process.argv.slice(2))
if (!options.apk) fail('Uso: npm run prepare:android-update -- --apk <archivo.apk> --notes "Detalle en español" [--mandatory]')
const expectedCertificateSha256 = await loadExpectedCertificateSha256()
const sourceApk = resolve(options.apk)
if (!existsSync(sourceApk)) fail(`No existe la APK: ${sourceApk}`)

const tools = findAndroidTools()
const badging = run(tools.aapt, ['dump', 'badging', sourceApk])
const packageLine = badging.split(/\r?\n/).find(line => line.startsWith('package:')) || ''
const packageName = capture(packageLine, /name='([^']+)'/, 'paquete')
const versionCode = Number(capture(packageLine, /versionCode='([^']+)'/, 'versionCode'))
const versionName = capture(packageLine, /versionName='([^']+)'/, 'versionName')
if (packageName !== EXPECTED_PACKAGE) fail(`Paquete rechazado: ${packageName}. Se esperaba ${EXPECTED_PACKAGE}.`)
if (!Number.isSafeInteger(versionCode) || versionCode <= LAST_DISTRIBUTED_VERSION_CODE) {
  fail(`versionCode ${versionCode} rechazado. Debe ser mayor que ${LAST_DISTRIBUTED_VERSION_CODE}.`)
}

const signing = run(tools.java, ['-jar', tools.apksignerJar, 'verify', '--verbose', '--print-certs', sourceApk])
const certificate = capture(signing, /Signer #1 certificate SHA-256 digest:\s*([A-Fa-f0-9:]+)/, 'certificado SHA-256').replaceAll(':', '').toLowerCase()
if (certificate !== expectedCertificateSha256) {
  fail(`Certificado rechazado. Huella encontrada: ${certificate}. No se preparó ninguna actualización.`)
}

async function loadExpectedCertificateSha256() {
  const environmentValue = process.env.SAN_JOSE_CERTIFICATE_SHA256?.trim()
  let configuredValue = environmentValue || ''
  const propertiesPath = resolve('android', 'signing.properties')
  if (!configuredValue && existsSync(propertiesPath)) {
    const properties = parseProperties(await readFile(propertiesPath, 'utf8'))
    configuredValue = properties.certificateSha256 || ''
  }
  const normalized = configuredValue.replaceAll(':', '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail('Falta certificateSha256 válido en android/signing.properties o SAN_JOSE_CERTIFICATE_SHA256. No se acepta la firma histórica ni una firma desconocida.')
  }
  return normalized
}

function parseProperties(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return []
    const separator = trimmed.indexOf('=')
    return separator < 1 ? [] : [[trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()]]
  }))
}

const previousManifestPath = join(HOSTING_ROOT, 'update.json')
if (existsSync(previousManifestPath)) {
  const previous = JSON.parse(await readFile(previousManifestPath, 'utf8'))
  if (Number(previous.versionCode) >= versionCode) fail(`Ya existe una publicación con versionCode ${previous.versionCode}; la nueva debe ser mayor.`)
}

const safeVersion = versionName.replace(/[^0-9A-Za-z._-]/g, '-')
const fileName = `embutidos-san-jose-${safeVersion}-${versionCode}.apk`
const targetApk = join(HOSTING_ROOT, 'apk', fileName)
const releaseApk = join(RELEASE_ROOT, fileName)
await mkdir(dirname(targetApk), { recursive: true })
await mkdir(RELEASE_ROOT, { recursive: true })
await copyFile(sourceApk, targetApk)
await copyFile(sourceApk, releaseApk)

const apkStat = await stat(targetApk)
const sha256 = await hashFile(targetApk)
const minimumSupportedVersionCode = options.minimumSupportedVersionCode === undefined
  ? undefined
  : Number(options.minimumSupportedVersionCode)
if (minimumSupportedVersionCode !== undefined && (!Number.isSafeInteger(minimumSupportedVersionCode) || minimumSupportedVersionCode <= 0 || minimumSupportedVersionCode > versionCode)) {
  fail('El versionCode mínimo compatible no es válido.')
}

const manifest = {
  versionCode,
  versionName,
  apkUrl: `https://pachax-flow.web.app/updates/san-jose/apk/${fileName}`,
  sha256,
  sizeBytes: apkStat.size,
  publishedAt: new Date().toISOString(),
  releaseNotes: options.notes.length > 0 ? options.notes : ['Mejoras de estabilidad y seguridad.'],
  mandatory: options.mandatory,
  ...(minimumSupportedVersionCode === undefined ? {} : { minimumSupportedVersionCode }),
}
await writeFile(previousManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log('Actualización Android preparada localmente; NO fue desplegada.')
console.log(`APK revisada: ${basename(sourceApk)}`)
console.log(`Paquete: ${packageName}`)
console.log(`Versión: ${versionName} (${versionCode})`)
console.log(`Certificado SHA-256: ${certificate}`)
console.log(`Archivo para revisión: ${releaseApk}`)
console.log(`Carpeta preparada para Hosting: ${HOSTING_ROOT}`)

function parseArguments(args) {
  const parsed = { apk: '', notes: [], mandatory: false, minimumSupportedVersionCode: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--apk') parsed.apk = args[++index] || ''
    else if (argument === '--notes') parsed.notes.push(args[++index] || '')
    else if (argument === '--mandatory') parsed.mandatory = true
    else if (argument === '--minimum-supported-version-code') parsed.minimumSupportedVersionCode = args[++index]
    else fail(`Argumento desconocido: ${argument}`)
  }
  parsed.notes = parsed.notes.map(note => note.trim()).filter(Boolean)
  return parsed
}

function findAndroidTools() {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
  ].filter(Boolean)
  const sdkRoot = sdkRoots.find(root => existsSync(join(root, 'build-tools')))
  if (!sdkRoot) fail('No se encontró Android SDK. Configura ANDROID_HOME antes de preparar una actualización.')
  const versions = readdirSync(join(sdkRoot, 'build-tools'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  const buildTools = versions.map(version => join(sdkRoot, 'build-tools', version))
    .find(directory => existsSync(join(directory, process.platform === 'win32' ? 'aapt.exe' : 'aapt')) && existsSync(join(directory, 'lib', 'apksigner.jar')))
  if (!buildTools) fail('No se encontraron aapt y apksigner en Android SDK Build Tools.')
  const javaHome = process.env.JAVA_HOME
  const java = javaHome && existsSync(join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
    ? join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java'
  return {
    aapt: join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
    apksignerJar: join(buildTools, 'lib', 'apksigner.jar'),
    java,
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error) fail(`No se pudo ejecutar ${basename(command)}: ${result.error.message}`)
  if (result.status !== 0) fail(`${basename(command)} rechazó la APK: ${(result.stderr || result.stdout || '').trim()}`)
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

function capture(text, expression, label) {
  const match = text.match(expression)
  if (!match) fail(`No se pudo leer ${label} de la APK.`)
  return match[1]
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
