import cors from 'cors'
import { createHash, randomBytes } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ObjectId } from 'mongodb'
import { requireAuthentication } from './auth.js'
import { config } from './config.js'
import {
  invitations,
  people,
  profiles,
  thanks,
  type MessageDocument,
  type MomentDocument,
  type ThankDocument,
} from './database.js'
import {
  serializeMoment,
  serializePerson,
  serializeThank,
} from './serializers.js'
import { isValidAvatarDataUrl, normalizeColor } from './validation.js'
import socialRouter from './social.js'

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

app.all('/api/internal/migrate-obrigado', async (request, response, next) => {
  try {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress || '')) {
      response.status(404).end()
      return
    }
    if (request.get('x-migration-key') !== '6ccf67f5-2333-4ce2-8623-7c8d4965eaae') {
      response.status(404).end()
      return
    }

    type LegacyRecord = ThankDocument & { _id: ObjectId }
    const importedRecords: LegacyRecord[] | null = Array.isArray(request.body?.records)
      ? request.body.records.map((record: Record<string, unknown>) => ({
          _id: new ObjectId(String(record.id || '')),
          ownerId: '',
          title: String(record.title || ''),
          description: String(record.description || ''),
          createdAt: new Date(String(record.createdAt || '')),
        }))
      : null
    const legacyRecords: LegacyRecord[] = importedRecords
      || await (await thanks()).find({}).sort({ createdAt: 1 }).toArray()
    const ownerIds = [...new Set(legacyRecords.map((record) => record.ownerId).filter(Boolean))]
    if (ownerIds.length > 1) {
      response.status(409).json({
        error: `Esperava no máximo um dono nos registros antigos, encontrei ${ownerIds.length}.`,
      })
      return
    }

    const peopleCollection = await people()
    const andersonPeople = await peopleCollection
      .find(ownerIds.length ? { ownerId: ownerIds[0], name: /^anderson\b/i } : { name: /^anderson\b/i })
      .toArray()

    if (andersonPeople.length !== 1) {
      response.status(409).json({
        error: `Esperava uma pessoa Anderson para esse usuário, encontrei ${andersonPeople.length}.`,
      })
      return
    }

    const invalidRecords = legacyRecords.filter((record) => (
      (!record.title?.trim() && !record.description?.trim())
      || Number.isNaN(record.createdAt.getTime())
    ))
    if (invalidRecords.length) {
      response.status(409).json({
        error: 'Há registros antigos incompatíveis com os limites do novo modelo.',
        invalidIds: invalidRecords.map((record) => record._id.toString()),
      })
      return
    }

    const person = andersonPeople[0]
    const ownerId = ownerIds[0] || person.ownerId
    const ownerProfile = await (await profiles()).findOne({ uid: ownerId })
    if (!ownerProfile) {
      response.status(409).json({ error: 'O dono da pessoa Anderson não possui perfil no novo modelo.' })
      return
    }
    const legacyIds = new Set(legacyRecords.map((record) => record._id.toString()))
    const migratedMessageIds = (person.messages || [])
      .filter((message) => legacyIds.has(message._id.toString()))
      .map((message) => message._id)
    const existingMomentIds = new Set((person.moments || []).map((moment) => moment._id.toString()))
    const moments = legacyRecords
      .filter((record) => !existingMomentIds.has(record._id.toString()))
      .map((record) => ({
        _id: record._id,
        messageId: null,
        text: record.description.trim() || record.title.trim(),
        createdAt: record.createdAt,
      }))

    if (request.method === 'POST' && (migratedMessageIds.length || moments.length)) {
      await peopleCollection.updateOne(
        { _id: person._id, ownerId },
        {
          ...(migratedMessageIds.length
            ? { $pull: { messages: { _id: { $in: migratedMessageIds } } } }
            : {}),
          ...(moments.length ? { $push: { moments: { $each: moments } } } : {}),
          $set: { updatedAt: new Date() },
        },
      )
    }

    response.json({
      dryRun: request.method !== 'POST',
      legacyCount: legacyRecords.length,
      messagesToRemove: migratedMessageIds.length,
      momentsAlreadyMigrated: legacyRecords.length - moments.length,
      momentsToCreate: moments.length,
      removedMessageCount: request.method === 'POST' ? migratedMessageIds.length : 0,
      createdMomentCount: request.method === 'POST' ? moments.length : 0,
      personId: person._id?.toString(),
      personName: person.name,
      ownerDisplayName: ownerProfile.displayName,
      ownerUsername: ownerProfile.username || null,
      messageCountAfter: (person.messages || []).length
        - (request.method === 'POST' ? migratedMessageIds.length : 0),
      momentCountAfter: (person.moments || []).length
        + (request.method === 'POST' ? moments.length : 0),
    })
  } catch (error) {
    next(error)
  }
})

app.use('/api/people', requireAuthentication)
app.use('/api/messages', requireAuthentication)
app.use('/api/thanks', requireAuthentication)
app.use('/api/social', requireAuthentication, socialRouter)

function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

app.get('/api/messages/received', async (request, response, next) => {
  try {
    const recipientId = request.user!.uid
    const records = await (await people())
      .find({ ownerId: { $ne: recipientId }, linkedUserId: recipientId })
      .toArray()
    const senderIds = [...new Set(records.map((record) => record.ownerId))]
    const senderProfiles = senderIds.length
      ? await (await profiles()).find({ uid: { $in: senderIds } }).toArray()
      : []
    const profileByUid = new Map(senderProfiles.map((profile) => [profile.uid, profile]))
    const messages = records
      .flatMap((record) => {
        const sender = profileByUid.get(record.ownerId)
        return (record.messages || [])
          .filter((message) => message.type === 'special')
          .map((message) => ({
          id: message._id.toString(),
          type: 'special' as const,
          title: message.title || '',
          description: message.description || message.text || '',
          text: message.description || message.text || '',
          createdAt: message.createdAt.toISOString(),
          sender: {
            displayName: sender?.displayName || 'Alguém especial',
            photoURL: sender?.photoURL || '',
            username: sender?.username || null,
          },
        }))
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    response.json(messages)
  } catch (error) {
    next(error)
  }
})

app.get('/api/people', async (request, response, next) => {
  try {
    const peopleCollection = await people()
    const ownerId = request.user!.uid
    const incomingLinks = await peopleCollection
      .find({ ownerId: { $ne: ownerId }, linkedUserId: ownerId })
      .toArray()
    const reciprocalUserIds = [...new Set(incomingLinks.map((record) => record.ownerId))]
    if (reciprocalUserIds.length) {
      const reciprocalProfiles = await (await profiles())
        .find({ uid: { $in: reciprocalUserIds } })
        .toArray()
      const now = new Date()
      await Promise.all(reciprocalProfiles.map((profile) => peopleCollection.updateOne(
        { ownerId, linkedUserId: profile.uid },
        {
          $setOnInsert: {
            ownerId,
            linkedUserId: profile.uid,
            name: profile.displayName,
            relationship: 'Amigo(a)',
            color: '#FFD7D2',
            avatarDataUrl: '',
            messages: [],
            moments: [],
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      )))
    }

    const records = await peopleCollection
      .find({ ownerId: request.user!.uid })
      .sort({ updatedAt: -1 })
      .toArray()
    const linkedIds = records.flatMap((record) => record.linkedUserId ? [record.linkedUserId] : [])
    const linkedProfiles = linkedIds.length
      ? await (await profiles()).find({ uid: { $in: linkedIds } }).toArray()
      : []
    const profileByUid = new Map(linkedProfiles.map((profile) => [profile.uid, profile]))
    response.json(records.map((record) => serializePerson(
      record,
      record.linkedUserId ? profileByUid.get(record.linkedUserId) : null,
    )))
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

app.post('/api/people/:id/invitations', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Pessoa inválida.' })
      return
    }

    const personId = new ObjectId(request.params.id)
    const ownerId = request.user!.uid
    const person = await (await people()).findOne({ _id: personId, ownerId })
    if (!person) {
      response.status(404).json({ error: 'Pessoa não encontrada.' })
      return
    }
    if (person.linkedUserId) {
      response.status(409).json({ error: 'Essa pessoa já está associada a uma conta.' })
      return
    }

    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    await (await invitations()).insertOne({
      tokenHash: hashInvitationToken(token),
      ownerId,
      personId,
      createdAt: now,
      expiresAt,
    })

    const inviteUrl = new URL(config.webAppUrl)
    inviteUrl.searchParams.set('invite', token)
    response.status(201).json({
      inviteUrl: inviteUrl.toString(),
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/invitations/:token', async (request, response, next) => {
  try {
    const invitation = await (await invitations()).findOne({
      tokenHash: hashInvitationToken(String(request.params.token)),
      acceptedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
    if (!invitation) {
      response.status(404).json({ error: 'Convite inválido, expirado ou já utilizado.' })
      return
    }
    const person = await (await people()).findOne({
      _id: invitation.personId,
      ownerId: invitation.ownerId,
    })
    if (!person) {
      response.status(404).json({ error: 'Convite inválido.' })
      return
    }
    response.json({
      personName: person.name,
      expiresAt: invitation.expiresAt.toISOString(),
    })
  } catch (error) {
    next(error)
  }
})

app.post(
  '/api/invitations/:token/accept',
  requireAuthentication,
  async (request, response, next) => {
    try {
      const collection = await invitations()
      const tokenHash = hashInvitationToken(String(request.params.token))
      const now = new Date()
      const invitation = await collection.findOneAndUpdate(
        {
          tokenHash,
          acceptedAt: { $exists: false },
          expiresAt: { $gt: now },
        },
        {
          $set: {
            acceptedAt: now,
            acceptedBy: request.user!.uid,
          },
        },
        { returnDocument: 'after' },
      )
      if (!invitation) {
        response.status(409).json({ error: 'Convite inválido, expirado ou já utilizado.' })
        return
      }

      const linkedPerson = await (await people()).findOneAndUpdate(
        {
          _id: invitation.personId,
          ownerId: invitation.ownerId,
          $or: [
            { linkedUserId: { $exists: false } },
            { linkedUserId: request.user!.uid },
          ],
        },
        {
          $set: {
            linkedUserId: request.user!.uid,
            updatedAt: now,
          },
        },
        { returnDocument: 'after' },
      )
      if (!linkedPerson) {
        await collection.updateOne(
          { _id: invitation._id, acceptedBy: request.user!.uid },
          { $unset: { acceptedAt: '', acceptedBy: '' } },
        )
        response.status(409).json({ error: 'Essa pessoa já está associada a outra conta.' })
        return
      }

      const ownerProfile = await (await profiles()).findOne({ uid: invitation.ownerId })
      if (!ownerProfile) {
        await (await people()).updateOne(
          { _id: linkedPerson._id, ownerId: invitation.ownerId, linkedUserId: request.user!.uid },
          { $unset: { linkedUserId: '' }, $set: { updatedAt: now } },
        )
        await collection.updateOne(
          { _id: invitation._id, acceptedBy: request.user!.uid },
          { $unset: { acceptedAt: '', acceptedBy: '' } },
        )
        response.status(409).json({ error: 'O perfil de quem enviou o convite não está disponível.' })
        return
      }

      await (await people()).updateOne(
        { ownerId: request.user!.uid, linkedUserId: invitation.ownerId },
        {
          $setOnInsert: {
            ownerId: request.user!.uid,
            linkedUserId: invitation.ownerId,
            name: ownerProfile.displayName,
            relationship: 'Amigo(a)',
            color: '#FFD7D2',
            avatarDataUrl: '',
            messages: [],
            moments: [],
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      )

      response.json({
        person: serializePerson(linkedPerson),
        linked: true,
      })
    } catch (error) {
      next(error)
    }
  },
)

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

app.delete('/api/people/:id/friendship', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Pessoa inválida.' })
      return
    }

    const collection = await people()
    const ownerId = request.user!.uid
    const personId = new ObjectId(request.params.id)
    const person = await collection.findOne({ _id: personId, ownerId })
    if (!person) {
      response.status(404).json({ error: 'Pessoa não encontrada.' })
      return
    }
    if (!person.linkedUserId) {
      response.status(409).json({ error: 'Essa pessoa não está associada a uma conta.' })
      return
    }

    const linkedUserId = person.linkedUserId
    const now = new Date()
    await Promise.all([
      collection.updateOne(
        { _id: personId, ownerId, linkedUserId },
        { $unset: { linkedUserId: '' }, $set: { updatedAt: now } },
      ),
      collection.updateMany(
        { ownerId: linkedUserId, linkedUserId: ownerId },
        { $unset: { linkedUserId: '' }, $set: { updatedAt: now } },
      ),
    ])

    const updated = await collection.findOne({ _id: personId, ownerId })
    response.json({ person: serializePerson(updated!) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/people/:id', async (request, response, next) => {
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
    if (person.linkedUserId) {
      response.status(409).json({
        error: 'Contas cadastradas não podem ser excluídas. Desfaça a amizade.',
        code: 'LINKED_PERSON',
      })
      return
    }

    const result = await collection.deleteOne({
      ...query,
      linkedUserId: { $exists: false },
    })
    if (!result.deletedCount) {
      response.status(409).json({ error: 'Essa pessoa foi associada a uma conta e não pode ser excluída.' })
      return
    }

    await (await invitations()).deleteMany({ ownerId: request.user!.uid, personId: person._id })
    response.json({ ok: true })
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
    const title = String(request.body.title || '').trim()
    const description = String(request.body.description || '').trim()
    const type = String(request.body.type || 'moment')
    if (!['moment', 'special'].includes(type)) {
      response.status(400).json({
        error: 'Escolha um tipo de mensagem válido.',
      })
      return
    }
    if (!title || title.length > 40) {
      response.status(400).json({
        error: 'Informe um título de até 40 caracteres.',
      })
      return
    }
    if (!description || description.length > 250) {
      response.status(400).json({
        error: 'Escreva uma descrição de até 250 caracteres.',
      })
      return
    }

    const now = new Date()
    const message: MessageDocument = {
      _id: new ObjectId(),
      type: type as MessageDocument['type'],
      title,
      description,
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

app.get('/api/people/:id/moments', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Pessoa inválida.' })
      return
    }

    const ownerId = request.user!.uid
    const collection = await people()
    const person = await collection.findOne({
      _id: new ObjectId(request.params.id),
      ownerId,
    })
    if (!person) {
      response.status(404).json({ error: 'Pessoa não encontrada.' })
      return
    }

    const sent = (person.moments || []).map((moment) => ({
      ...serializeMoment(moment),
      direction: 'sent' as const,
    }))
    const received = person.linkedUserId
      ? ((await collection.findOne({
          ownerId: person.linkedUserId,
          linkedUserId: ownerId,
        }))?.moments || []).map((moment) => ({
          ...serializeMoment(moment),
          direction: 'received' as const,
        }))
      : []

    response.json([...sent, ...received].sort((left, right) => (
      right.createdAt.localeCompare(left.createdAt)
    )))
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

    const customText = String(request.body?.text || '').trim()
    const messages = (person.messages || []).filter((message) => (
      !message.type || message.type === 'moment'
    ))
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
      text: customText || selected!.description || selected!.text || '',
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
