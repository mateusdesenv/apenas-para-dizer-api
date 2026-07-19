const baseUrl = (
  process.env.API_URL || 'https://apenas-para-dizer-api.vercel.app'
).replace(/\/$/, '')
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5173'
const resourceId = '507f1f77bcf86cd799439011'

const endpoints = [
  ['GET', '/', 200, false],
  ['GET', '/api/health', 200, false],
  ['GET', '/api/people', 401, false],
  ['POST', '/api/people', 401, true],
  ['GET', `/api/people/${resourceId}`, 401, false],
  ['PATCH', `/api/people/${resourceId}`, 401, true],
  ['POST', `/api/people/${resourceId}/messages`, 401, true],
  ['POST', `/api/people/${resourceId}/moments`, 401, true],
  ['GET', '/api/thanks', 401, false],
  ['POST', '/api/thanks', 401, true],
  ['DELETE', `/api/thanks/${resourceId}`, 401, true],
]

let failures = 0

function report(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures += 1
}

for (const [method, path, expectedStatus, requiresPreflight] of endpoints) {
  if (requiresPreflight) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    const allowedOrigin = response.headers.get('access-control-allow-origin')
    report(
      response.status === 204 && allowedOrigin === origin,
      `OPTIONS ${path} -> ${response.status}, cors=${allowedOrigin || '-'}`,
    )
  }

  const headers = { Origin: origin }
  if (method !== 'GET') headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : '{}',
  })
  const publicEndpoint = path === '/' || path === '/api/health'
  const allowedOrigin = publicEndpoint
    ? origin
    : response.headers.get('access-control-allow-origin')
  report(
    response.status === expectedStatus && allowedOrigin === origin,
    `${method} ${path} -> ${response.status}, expected=${expectedStatus}`,
  )
}

if (failures > 0) {
  throw new Error(`${failures} verificações de contrato falharam.`)
}

console.log(
  `Contrato válido: ${endpoints.length} endpoints e ${
    endpoints.filter((endpoint) => endpoint[3]).length
  } preflights.`,
)
