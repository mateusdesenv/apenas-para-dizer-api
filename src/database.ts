import { Collection, MongoClient, ObjectId } from 'mongodb'
import { config } from './config.js'

export interface MessageDocument {
  _id: ObjectId
  text: string
  createdAt: Date
}

export interface MomentDocument {
  _id: ObjectId
  messageId: ObjectId | null
  text: string
  createdAt: Date
}

export interface PersonDocument {
  _id?: ObjectId
  ownerId: string
  linkedUserId?: string
  name: string
  relationship: string
  color: string
  avatarDataUrl: string
  messages: MessageDocument[]
  moments: MomentDocument[]
  createdAt: Date
  updatedAt: Date
}

export interface InvitationDocument {
  _id?: ObjectId
  tokenHash: string
  ownerId: string
  personId: ObjectId
  createdAt: Date
  expiresAt: Date
  acceptedAt?: Date
  acceptedBy?: string
}

export interface UserProfileDocument {
  _id?: ObjectId
  uid: string
  username?: string
  normalizedUsername?: string
  displayName: string
  photoURL: string
  createdAt: Date
  updatedAt: Date
}

export interface FriendRequestDocument {
  _id?: ObjectId
  senderId: string
  recipientId: string
  personId?: ObjectId
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: Date
  updatedAt: Date
}

export interface ThankDocument {
  _id?: ObjectId
  ownerId: string
  title: string
  description: string
  createdAt: Date
}

const client = new MongoClient(config.mongoUri)
let peopleCollection: Collection<PersonDocument> | undefined
let invitationsCollection: Collection<InvitationDocument> | undefined
let profilesCollection: Collection<UserProfileDocument> | undefined
let friendRequestsCollection: Collection<FriendRequestDocument> | undefined
let thanksCollection: Collection<ThankDocument> | undefined

async function database() {
  await client.connect()
  return client.db(config.dbName)
}

export async function people(): Promise<Collection<PersonDocument>> {
  if (!peopleCollection) {
    peopleCollection = (await database()).collection(config.peopleCollection)
    await Promise.all([
      peopleCollection.createIndex({ ownerId: 1, name: 1 }),
      peopleCollection.createIndex({ ownerId: 1, updatedAt: -1 }),
      peopleCollection.createIndex(
        { ownerId: 1, linkedUserId: 1 },
        { partialFilterExpression: { linkedUserId: { $type: 'string' } } },
      ),
    ])
  }
  return peopleCollection
}

export async function invitations(): Promise<Collection<InvitationDocument>> {
  if (!invitationsCollection) {
    invitationsCollection = (await database()).collection('invitations')
    await Promise.all([
      invitationsCollection.createIndex({ tokenHash: 1 }, { unique: true }),
      invitationsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      invitationsCollection.createIndex({ ownerId: 1, personId: 1, createdAt: -1 }),
    ])
  }
  return invitationsCollection
}

export async function profiles(): Promise<Collection<UserProfileDocument>> {
  if (!profilesCollection) {
    profilesCollection = (await database()).collection('profiles')
    await Promise.all([
      profilesCollection.createIndex({ uid: 1 }, { unique: true }),
      profilesCollection.createIndex(
        { normalizedUsername: 1 },
        {
          unique: true,
          partialFilterExpression: { normalizedUsername: { $type: 'string' } },
        },
      ),
    ])
  }
  return profilesCollection
}

export async function friendRequests(): Promise<Collection<FriendRequestDocument>> {
  if (!friendRequestsCollection) {
    friendRequestsCollection = (await database()).collection('friendRequests')
    await Promise.all([
      friendRequestsCollection.createIndex({ recipientId: 1, status: 1, createdAt: -1 }),
      friendRequestsCollection.createIndex({ senderId: 1, status: 1, createdAt: -1 }),
      friendRequestsCollection.createIndex(
        { senderId: 1, recipientId: 1 },
        { unique: true, partialFilterExpression: { status: 'pending' } },
      ),
    ])
  }
  return friendRequestsCollection
}

export async function thanks(): Promise<Collection<ThankDocument>> {
  if (!thanksCollection) {
    thanksCollection = (await database()).collection(config.thanksCollection)
    await thanksCollection.createIndex({ ownerId: 1, createdAt: -1 })
  }
  return thanksCollection
}
