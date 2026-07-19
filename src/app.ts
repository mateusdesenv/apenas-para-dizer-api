import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ObjectId } from 'mongodb'
import { requireAuthentication } from './auth.js'
import { config } from './config.js'
import {
  people,
  thanks,
  type MessageDocument,
  type MomentDocument,
} from './database.js'
import {
  serializeMoment,
  serializePerson,
  serializeThank,
} from './serializers.js'
import { isValidAvatarDataUrl, normalizeColor } from './validation.js'

const app = express()

app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || config.corsOrigins.includes(origin))
  },
}))
app.use(express.json({ limit: '3mb' }))
app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'private, no-store, max-age=0')
  response.set('Pragma', 'no-cache')
  next()
})

app.get('/', (_request, response) => {
  response.json({
    name: 'Apenas Para Dizer API',
    status: 'online',
    health: '/api/health',
  })
})

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.use('/api/people', requireAuthentication)
app.use('/api/thanks', requireAuthentication)

app.get('/api/people', async (request, response, next) => {
  try {
    const records = await (await people())
      .find({ ownerId: request.user!.uid })
      .sort({ updatedAt: -1 })
      .toArray()
    response.json(records.map(serializePerson))
  } catch (error) {
    next(error)
  }
})

app.post('/api/people', async (request, response, next) => {
  try {
    const name = String(request.body.name || '').trim()
    const relationship = String(request.body.relationship || '').trim()
    const color = normalizeColor(String(request.body.color || ''))
    const avatarDataUrl = String(request.body.avatarDataUrl || '')

    if (!name) {
      response.status(400).json({ error: 'Informe o nome da pessoa.' })
      return
    }
    if (!isValidAvatarDataUrl(avatarDataUrl)) {
      response.status(400).json({
        error: 'Use uma imagem JPEG, PNG ou WebP de até 2 MB.',
      })
      return
    }

    const now = new Date()
    const collection = await people()
    const result = await collection.insertOne({
      ownerId: request.user!.uid,
      name,
      relationship,
      color,
      avatarDataUrl,
      messages: [],
      moments: [],
      createdAt: now,
      updatedAt: now,
    })
    const created = await collection.findOne({ _id: result.insertedId })
    response.status(201).json(serializePerson(created!))
  } catch (error) {
    next(error)
  }
})

app.get('/api/people/:id', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Pessoa inválida.' })
      return
    }
    const person = await (await people()).findOne({
      _id: new ObjectId(request.params.id),
      ownerId: request.user!.uid,
    })
    if (!person) {
      response.status(404).json({ error: 'Pessoa não encontrada.' })
      return
    }
    response.json(serializePerson(person))
  } catch (error) {
    next(error)
  }
})

app.patch('/api/people/:id', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Pessoa inválida.' })
      return
    }
    const name = String(request.body.name || '').trim()
    const avatarDataUrl = String(request.body.avatarDataUrl || '')
    if (!name) {
      response.status(400).json({ error: 'Informe o nome da pessoa.' })
      return
    }
    if (!isValidAvatarDataUrl(avatarDataUrl)) {
      response.status(400).json({
        error: 'Use uma imagem JPEG, PNG ou WebP de até 2 MB.',
      })
      return
    }

    const updated = await (await people()).findOneAndUpdate(
      {
        _id: new ObjectId(request.params.id),
        ownerId: request.user!.uid,
      },
      {
        $set: {
          name,
          relationship: String(request.body.relationship || '').trim(),
          color: normalizeColor(String(request.body.color || '')),
          avatarDataUrl,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    )
    if (!updated) {
      response.status(404).json({ error: 'Pessoa não encontrada.' })
      return
    }
    response.json(serializePerson(updated))
  } catch (error) {
    next(error)
  }
})

app.post('/api/people/:id/messages', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Pessoa inválida.' })
      return
    }
    const text = String(request.body.text || '').trim()
    if (!text || text.length > 280) {
      response.status(400).json({
        error: 'Escreva uma mensagem de até 280 caracteres.',
      })
      return
    }

    const now = new Date()
    const message: MessageDocument = {
      _id: new ObjectId(),
      text,
      createdAt: now,
    }
    const updated = await (await people()).findOneAndUpdate(
      {
        _id: new ObjectId(request.params.id),
        ownerId: request.user!.uid,
      },
      { $push: { messages: message }, $set: { updatedAt: now } },
      { returnDocument: 'after' },
    )
    if (!updated) {
      response.status(404).json({ error: 'Pessoa não encontrada.' })
      return
    }
    response.status(201).json(serializePerson(updated))
  } catch (error) {
    next(error)
  }
})

app.post('/api/people/:id/moments', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Pessoa inválida.' })
      return
    }
    const collection = await people()
    const query = {
      _id: new ObjectId(request.params.id),
      ownerId: request.user!.uid,
    }
    const person = await collection.findOne(query)
    if (!person) {
      response.status(404).json({ error: 'Pessoa não encontrada.' })
      return
    }

    const customText = String(request.body.text || '').trim()
    const messages = person.messages || []
    if (!customText && messages.length === 0) {
      response.status(409).json({
        error: 'Cadastre ao menos uma mensagem para essa pessoa.',
        code: 'NO_MESSAGES',
      })
      return
    }

    const selected = customText
      ? undefined
      : messages[Math.floor(Math.random() * messages.length)]
    const moment: MomentDocument = {
      _id: new ObjectId(),
      messageId: selected?._id || null,
      text: customText || selected!.text,
      createdAt: new Date(),
    }
    const updated = await collection.findOneAndUpdate(
      query,
      {
        $push: { moments: moment },
        $set: { updatedAt: moment.createdAt },
      },
      { returnDocument: 'after' },
    )
    response.status(201).json({
      person: serializePerson(updated!),
      moment: serializeMoment(moment),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/thanks', async (request, response, next) => {
  try {
    const records = await (await thanks())
      .find({ ownerId: request.user!.uid })
      .sort({ createdAt: -1 })
      .toArray()
    response.json(records.map(serializeThank))
  } catch (error) {
    next(error)
  }
})

app.post('/api/thanks', async (request, response, next) => {
  try {
    const collection = await thanks()
    const result = await collection.insertOne({
      ownerId: request.user!.uid,
      title: String(request.body.title || '').trim() || 'Obrigado, Anderson',
      description: String(request.body.description || '').trim(),
      createdAt: new Date(),
    })
    response.status(201).json(
      serializeThank((await collection.findOne({ _id: result.insertedId }))!),
    )
  } catch (error) {
    next(error)
  }
})

app.delete('/api/thanks/:id', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Registro inválido.' })
      return
    }
    const result = await (await thanks()).deleteOne({
      _id: new ObjectId(request.params.id),
      ownerId: request.user!.uid,
    })
    if (!result.deletedCount) {
      response.status(404).json({ error: 'Registro não encontrado.' })
      return
    }
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

app.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error)
    response.status(500).json({
      error: 'Não foi possível acessar seus dados agora.',
    })
  },
)

export default app
