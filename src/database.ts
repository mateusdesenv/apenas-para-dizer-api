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
  name: string
  relationship: string
  color: string
  avatarDataUrl: string
  messages: MessageDocument[]
  moments: MomentDocument[]
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
    ])
  }
  return peopleCollection
}

export async function thanks(): Promise<Collection<ThankDocument>> {
  if (!thanksCollection) {
    thanksCollection = (await database()).collection(config.thanksCollection)
    await thanksCollection.createIndex({ ownerId: 1, createdAt: -1 })
  }
  return thanksCollection
}
