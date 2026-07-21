import { Router } from 'express'
import { ObjectId } from 'mongodb'
import {
  friendRequests,
  people,
  profiles,
  type UserProfileDocument,
} from './database.js'

const router = Router()
const USERNAME_PATTERN = /^[a-zA-Z0-9._]{3,24}$/

function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase()
}

function publicProfile(profile: UserProfileDocument) {
  return {
    username: profile.username || null,
    displayName: profile.displayName,
    photoURL: profile.photoURL,
  }
}

function usernameFrom(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._]/g, '')
    .slice(0, 24)
}

async function syncProfile(uid: string, claims: Record<string, unknown>) {
  const collection = await profiles()
  const existing = await collection.findOne({ uid })
  const now = new Date()
  const displayName = String(claims.name || existing?.displayName || 'Pessoa').trim()
  const photoURL = String(claims.picture || existing?.photoURL || '').trim()
  await collection.updateOne(
    { uid },
    {
      $set: { displayName, photoURL, updatedAt: now },
      $setOnInsert: { uid, createdAt: now },
    },
    { upsert: true },
  )
  let profile = (await collection.findOne({ uid }))!
  if (!profile.username) {
    const linkedPerson = await (await people()).findOne(
      { linkedUserId: uid },
      { sort: { updatedAt: -1 } },
    )
    const base = usernameFrom(linkedPerson?.name || displayName)
    if (base.length >= 3) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const suffix = attempt ? String(attempt + 1) : ''
        const candidate = `${base.slice(0, 24 - suffix.length)}${suffix}`
        try {
          profile = (await collection.findOneAndUpdate(
            { uid, username: { $exists: false } },
            {
              $set: {
                username: candidate,
                normalizedUsername: normalizeUsername(candidate),
                updatedAt: now,
              },
            },
            { returnDocument: 'after' },
          )) || profile
          break
        } catch (error: unknown) {
          if ((error as { code?: number }).code !== 11000) throw error
        }
      }
    }
  }
  return profile
}

router.get('/me', async (request, response, next) => {
  try {
    const profile = await syncProfile(request.user!.uid, request.user! as unknown as Record<string, unknown>)
    response.json(publicProfile(profile))
  } catch (error) {
    next(error)
  }
})

router.patch('/me', async (request, response, next) => {
  try {
    const username = String(request.body.username || '').trim().replace(/^@/, '')
    if (!USERNAME_PATTERN.test(username)) {
      response.status(400).json({
        error: 'Use de 3 a 24 caracteres: letras, números, ponto ou sublinhado.',
      })
      return
    }
    const normalizedUsername = normalizeUsername(username)
    const collection = await profiles()
    await syncProfile(request.user!.uid, request.user! as unknown as Record<string, unknown>)
    try {
      const profile = await collection.findOneAndUpdate(
        { uid: request.user!.uid },
        { $set: { username, normalizedUsername, updatedAt: new Date() } },
        { returnDocument: 'after' },
      )
      response.json(publicProfile(profile!))
    } catch (error: unknown) {
      if ((error as { code?: number }).code === 11000) {
        response.status(409).json({ error: 'Esse nome de usuário já está em uso.' })
        return
      }
      throw error
    }
  } catch (error) {
    next(error)
  }
})

router.get('/users/search', async (request, response, next) => {
  try {
    const query = normalizeUsername(String(request.query.username || ''))
    if (query.length < 2) {
      response.json([])
      return
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const records = await (await profiles()).find({
      uid: { $ne: request.user!.uid },
      normalizedUsername: { $regex: `^${escaped}` },
    }).limit(10).toArray()
    response.json(records.map(publicProfile))
  } catch (error) {
    next(error)
  }
})

router.get('/friend-requests', async (request, response, next) => {
  try {
    await syncProfile(request.user!.uid, request.user! as unknown as Record<string, unknown>)
    const records = await (await friendRequests()).find({
      $or: [{ senderId: request.user!.uid }, { recipientId: request.user!.uid }],
    }).sort({ createdAt: -1 }).toArray()
    const ids = [...new Set(records.flatMap((item) => [item.senderId, item.recipientId]))]
    const profileRecords = await (await profiles()).find({ uid: { $in: ids } }).toArray()
    const byUid = new Map(profileRecords.map((profile) => [profile.uid, profile]))
    response.json(records.map((item) => {
      const incoming = item.recipientId === request.user!.uid
      const counterpart = byUid.get(incoming ? item.senderId : item.recipientId)
      return {
        id: item._id!.toString(),
        direction: incoming ? 'incoming' : 'outgoing',
        status: item.status,
        profile: counterpart ? publicProfile(counterpart) : null,
        createdAt: item.createdAt.toISOString(),
      }
    }))
  } catch (error) {
    next(error)
  }
})

router.post('/friend-requests', async (request, response, next) => {
  try {
    const normalizedUsername = normalizeUsername(String(request.body.username || ''))
    const profileCollection = await profiles()
    const recipient = await profileCollection.findOne({ normalizedUsername })
    if (!recipient) {
      response.status(404).json({ error: 'Nenhuma conta encontrada com esse @username.' })
      return
    }
    if (recipient.uid === request.user!.uid) {
      response.status(400).json({ error: 'Você não pode adicionar a própria conta.' })
      return
    }
    const existingFriend = await (await people()).findOne({
      ownerId: request.user!.uid,
      linkedUserId: recipient.uid,
    })
    if (existingFriend) {
      response.status(409).json({ error: 'Essa pessoa já faz parte do seu círculo.' })
      return
    }
    let personId: ObjectId | undefined
    if (ObjectId.isValid(String(request.body.personId || ''))) {
      const person = await (await people()).findOne({
        _id: new ObjectId(String(request.body.personId)),
        ownerId: request.user!.uid,
        linkedUserId: { $exists: false },
      })
      personId = person?._id
    }
    if (!personId) {
      const candidate = await (await people()).findOne({
        ownerId: request.user!.uid,
        linkedUserId: { $exists: false },
        name: { $regex: `^${recipient.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      })
      personId = candidate?._id
    }
    const now = new Date()
    const result = await (await friendRequests()).insertOne({
      senderId: request.user!.uid,
      recipientId: recipient.uid,
      personId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }).catch((error: unknown) => {
      if ((error as { code?: number }).code === 11000) return null
      throw error
    })
    if (!result) {
      response.status(409).json({ error: 'Você já enviou uma solicitação para essa pessoa.' })
      return
    }
    response.status(201).json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.post('/friend-requests/:id/accept', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Solicitação inválida.' })
      return
    }
    const collection = await friendRequests()
    const friendRequest = await collection.findOne({
      _id: new ObjectId(request.params.id),
      recipientId: request.user!.uid,
      status: 'pending',
    })
    if (!friendRequest) {
      response.status(404).json({ error: 'Solicitação não encontrada ou já respondida.' })
      return
    }
    const profileCollection = await profiles()
    const [sender, recipient] = await Promise.all([
      profileCollection.findOne({ uid: friendRequest.senderId }),
      syncProfile(request.user!.uid, request.user! as unknown as Record<string, unknown>),
    ])
    if (!sender) {
      response.status(409).json({ error: 'O perfil de quem enviou não está mais disponível.' })
      return
    }
    const peopleCollection = await people()
    const now = new Date()
    const senderPerson = friendRequest.personId
      ? await peopleCollection.findOneAndUpdate(
          { _id: friendRequest.personId, ownerId: friendRequest.senderId },
          { $set: { linkedUserId: recipient.uid, updatedAt: now } },
          { returnDocument: 'after' },
        )
      : null
    if (!senderPerson) {
      await peopleCollection.updateOne(
        { ownerId: friendRequest.senderId, linkedUserId: recipient.uid },
        {
          $setOnInsert: {
            ownerId: friendRequest.senderId,
            linkedUserId: recipient.uid,
            name: recipient.displayName,
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
    }
    await peopleCollection.updateOne(
      { ownerId: recipient.uid, linkedUserId: sender.uid },
      {
        $setOnInsert: {
          ownerId: recipient.uid,
          linkedUserId: sender.uid,
          name: sender.displayName,
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
    await collection.updateOne(
      { _id: friendRequest._id, status: 'pending' },
      { $set: { status: 'accepted', updatedAt: now } },
    )
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.post('/friend-requests/:id/reject', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      response.status(400).json({ error: 'Solicitação inválida.' })
      return
    }
    const result = await (await friendRequests()).updateOne(
      { _id: new ObjectId(request.params.id), recipientId: request.user!.uid, status: 'pending' },
      { $set: { status: 'rejected', updatedAt: new Date() } },
    )
    if (!result.modifiedCount) {
      response.status(404).json({ error: 'Solicitação não encontrada ou já respondida.' })
      return
    }
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

export default router
