const AUTH_COOKIE = 'atestat_session'
const LOCK_COOKIE = 'atestat_lock'
const LOGIN_PATH = '/__auth/login'
const LOGOUT_PATH = '/__auth/logout'
const MAX_ATTEMPTS = 5
const LOCK_MS = 5 * 60 * 1000
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

const encoder = new TextEncoder()
let signingKeyPromise

export const config = {
  runtime: 'edge',
  matcher: ['/((?!_vercel/insights|_vercel/speed-insights).*)'],
}

export default async function middleware(request) {
  const url = new URL(request.url)
  const authConfig = getAuthConfig()

  if (!authConfig.ready) {
    return renderLoginPage(request, {
      status: 500,
      title: 'Защита не настроена',
      message: 'На Vercel не заданы переменные AUTH_CREDENTIAL_HASH и AUTH_COOKIE_SECRET.',
      disabled: true,
    })
  }

  if (url.pathname === LOGOUT_PATH) {
    return redirect('/', request, [clearCookie(AUTH_COOKIE, request), clearCookie(LOCK_COOKIE, request)])
  }

  if (url.pathname === LOGIN_PATH && request.method === 'POST') {
    return handleLogin(request, authConfig)
  }

  const session = await readSignedCookie(request, AUTH_COOKIE, authConfig.cookieSecret)
  if (session?.user === authConfig.username && session.expiresAt > Date.now()) {
    if (url.pathname === LOGIN_PATH) return redirect('/', request)
    return undefined
  }

  const lock = await getLockState(request, authConfig.cookieSecret)
  return renderLoginPage(request, {
    status: lock.locked ? 429 : 401,
    title: 'Вход в Atestat',
    message: lock.locked ? `Слишком много неверных попыток. Повторите через ${formatRemaining(lock.lockedUntil - Date.now())}.` : '',
    disabled: lock.locked,
    nextPath: safeNextPath(url),
    clearCookies: [clearCookie(AUTH_COOKIE, request)],
  })
}

async function handleLogin(request, authConfig) {
  const lock = await getLockState(request, authConfig.cookieSecret)
  if (lock.locked) {
    return renderLoginPage(request, {
      status: 429,
      title: 'Вход временно заблокирован',
      message: `Повторите через ${formatRemaining(lock.lockedUntil - Date.now())}.`,
      disabled: true,
      nextPath: '/',
    })
  }

  const form = await request.formData()
  const username = String(form.get('username') || '').trim()
  const password = String(form.get('password') || '')
  const nextPath = sanitizeNextPath(String(form.get('next') || '/'))
  const credentialHash = await sha256Hex(`${username}\0${password}`)

  if (username === authConfig.username && timingSafeEqual(credentialHash, authConfig.credentialHash)) {
    const sessionCookie = await createSignedCookie(
      AUTH_COOKIE,
      { user: authConfig.username, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 },
      authConfig.cookieSecret,
      request,
      { maxAge: SESSION_MAX_AGE }
    )
    return redirect(nextPath, request, [sessionCookie, clearCookie(LOCK_COOKIE, request)])
  }

  const nextAttempts = lock.attempts + 1
  const lockedUntil = nextAttempts >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0
  const lockCookie = await createSignedCookie(
    LOCK_COOKIE,
    { attempts: nextAttempts, lockedUntil },
    authConfig.cookieSecret,
    request,
    { maxAge: Math.ceil(LOCK_MS / 1000) }
  )
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - nextAttempts)

  return renderLoginPage(request, {
    status: lockedUntil ? 429 : 401,
    title: lockedUntil ? 'Вход временно заблокирован' : 'Вход в Atestat',
    message: lockedUntil
      ? 'Слишком много неверных попыток. Повторите через 5:00.'
      : `Неверный логин или пароль. Осталось попыток: ${attemptsLeft}.`,
    disabled: Boolean(lockedUntil),
    nextPath,
    setCookies: [lockCookie],
  })
}

function getAuthConfig() {
  const username = process.env.AUTH_USERNAME || 'AdminClaw'
  const credentialHash = process.env.AUTH_CREDENTIAL_HASH || ''
  const cookieSecret = process.env.AUTH_COOKIE_SECRET || ''
  return {
    username,
    credentialHash,
    cookieSecret,
    ready: Boolean(credentialHash && cookieSecret),
  }
}

async function getLockState(request, secret) {
  const lock = await readSignedCookie(request, LOCK_COOKIE, secret)
  const lockedUntil = Number(lock?.lockedUntil || 0)
  if (lockedUntil && lockedUntil > Date.now()) {
    return { attempts: MAX_ATTEMPTS, locked: true, lockedUntil }
  }
  return { attempts: Number(lock?.attempts || 0), locked: false, lockedUntil: 0 }
}

async function createSignedCookie(name, payload, secret, request, options = {}) {
  const value = await signPayload(payload, secret)
  return serializeCookie(name, value, request, options)
}

async function readSignedCookie(request, name, secret) {
  const value = parseCookies(request.headers.get('cookie') || '')[name]
  if (!value) return null

  const [body, signature] = value.split('.')
  if (!body || !signature) return null

  const expected = await sign(body, secret)
  if (!timingSafeEqual(signature, expected)) return null

  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  } catch {
    return null
  }
}

async function signPayload(payload, secret) {
  const body = toBase64Url(JSON.stringify(payload))
  const signature = await sign(body, secret)
  return `${body}.${signature}`
}

async function sign(value, secret) {
  if (!signingKeyPromise) {
    signingKeyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
  }
  const key = await signingKeyPromise
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return toBase64Url(signature)
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseCookies(cookieHeader) {
  const cookies = {}
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) cookies[name] = value
  }
  return cookies
}

function serializeCookie(name, value, request, options = {}) {
  const url = new URL(request.url)
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (url.protocol === 'https:') parts.push('Secure')
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  return parts.join('; ')
}

function clearCookie(name, request) {
  return serializeCookie(name, '', request, { maxAge: 0, expires: new Date(0) })
}

function redirect(path, request, cookies = []) {
  const headers = new Headers({ Location: new URL(path, request.url).toString() })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 303, headers })
}

function renderLoginPage(request, options) {
  const {
    status,
    title,
    message = '',
    disabled = false,
    nextPath = safeNextPath(new URL(request.url)),
    setCookies = [],
    clearCookies = [],
  } = options
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
  })
  for (const cookie of [...setCookies, ...clearCookies]) headers.append('Set-Cookie', cookie)

  return new Response(loginHtml({ title, message, disabled, nextPath }), { status, headers })
}

function loginHtml({ title, message, disabled, nextPath }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #070816;
      color: #e5e7eb;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(420px, calc(100vw - 32px));
      border: 1px solid rgba(99, 102, 241, .24);
      border-radius: 18px;
      background: rgba(15, 23, 42, .92);
      box-shadow: 0 24px 80px rgba(0, 0, 0, .45);
      padding: 28px;
    }
    h1 { margin: 0 0 18px; font-size: 22px; line-height: 1.2; }
    label { display: block; margin-top: 14px; font-size: 12px; color: #a5b4fc; }
    input {
      width: 100%;
      margin-top: 7px;
      border: 1px solid rgba(99, 102, 241, .26);
      border-radius: 12px;
      background: #0f172a;
      color: #f8fafc;
      padding: 12px 13px;
      font-size: 15px;
      outline: none;
    }
    input:focus { border-color: rgba(129, 140, 248, .78); }
    button {
      width: 100%;
      margin-top: 20px;
      border: 0;
      border-radius: 12px;
      background: #6366f1;
      color: white;
      padding: 12px 14px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled { cursor: not-allowed; opacity: .45; }
    .message {
      margin: 0 0 14px;
      border: 1px solid rgba(248, 113, 113, .28);
      border-radius: 12px;
      background: rgba(127, 29, 29, .28);
      color: #fecaca;
      padding: 11px 12px;
      font-size: 13px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${message ? `<p class="message">${escapeHtml(message)}</p>` : ''}
    <form method="post" action="${LOGIN_PATH}">
      <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
      <label>
        Логин
        <input name="username" autocomplete="username" ${disabled ? 'disabled' : ''} autofocus>
      </label>
      <label>
        Пароль
        <input name="password" type="password" autocomplete="current-password" ${disabled ? 'disabled' : ''}>
      </label>
      <button type="submit" ${disabled ? 'disabled' : ''}>Войти</button>
    </form>
  </main>
</body>
</html>`
}

function toBase64Url(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function timingSafeEqual(a, b) {
  const left = String(a)
  const right = String(b)
  if (!left || !right) return false
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const leftCode = i < left.length ? left.charCodeAt(i) : 0
    const rightCode = i < right.length ? right.charCodeAt(i) : 0
    diff |= leftCode ^ rightCode
  }
  return diff === 0
}

function safeNextPath(url) {
  return sanitizeNextPath(`${url.pathname}${url.search}`)
}

function sanitizeNextPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  if (value.startsWith(LOGIN_PATH) || value.startsWith(LOGOUT_PATH)) return '/'
  return value
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
