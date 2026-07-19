import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} precisa estar definido.`)
  return value
}

export const config = {
  port: Number(process.env.PORT || 3001),
  mongoUri: required('MONGO_URI'),
  dbName: process.env.MONGO_DB_NAME || 'minuta',
  thanksCollection: process.env.MONGO_COLLECTION_NAME || 'obrigado',
  peopleCollection: process.env.MONGO_PEOPLE_COLLECTION_NAME || 'people',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'apenas-para-dizer',
  corsOrigins: (process.env.CORS_ORIGINS ||
    'https://anderson-obrigado.vercel.app,http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}
