import type { WithId } from 'mongodb'
import type {
  MessageDocument,
  MomentDocument,
  PersonDocument,
  UserProfileDocument,
  ThankDocument,
} from './database.js'

export function serializeMessage(message: MessageDocument) {
  return {
    id: message._id.toString(),
    text: message.text,
    createdAt: message.createdAt.toISOString(),
  }
}

export function serializeMoment(moment: MomentDocument) {
  return {
    id: moment._id.toString(),
    messageId: moment.messageId?.toString() || null,
    text: moment.text,
    createdAt: moment.createdAt.toISOString(),
  }
}

export function serializePerson(
  person: WithId<PersonDocument>,
  linkedProfile?: WithId<UserProfileDocument> | null,
) {
  return {
    id: person._id.toString(),
    name: linkedProfile?.displayName || person.name,
    relationship: person.relationship || '',
    color: person.color || '#FFD7D2',
    avatarDataUrl: linkedProfile?.photoURL || person.avatarDataUrl || '',
    isLinked: Boolean(person.linkedUserId),
    linkedUsername: linkedProfile?.username || null,
    messages: (person.messages || []).map(serializeMessage),
    moments: (person.moments || []).map(serializeMoment),
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
  }
}

export function serializeThank(record: WithId<ThankDocument>) {
  return {
    id: record._id.toString(),
    title: record.title || 'Obrigado, Anderson',
    description: record.description || '',
    createdAt: record.createdAt.toISOString(),
  }
}
