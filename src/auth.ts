import type { NextFunction, Request, Response } from 'express'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import { config } from './config.js'

declare global {
  namespace Express {
    interface Request {
      user?: DecodedIdToken
    }
  }
}

if (getApps().length === 0) {
  initializeApp({ projectId: config.firebaseProjectId })
}

export async function requireAuthentication(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const [scheme, token] = (request.get('authorization') || '').split(' ')
  if (scheme !== 'Bearer' || !token) {
    response.status(401).json({ error: 'Autenticação obrigatória.' })
    return
  }

  try {
    request.user = await getAuth().verifyIdToken(token)
    next()
  } catch {
    response.status(401).json({ error: 'Sessão inválida ou expirada.' })
  }
}
