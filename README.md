# Apenas Para Dizer API

API independente do produto **Apenas Para Dizer**, construída com Node.js,
TypeScript, Express, MongoDB e Firebase Authentication.

## Recursos

- pessoas isoladas por conta Firebase;
- upload de avatar Base64 (JPEG, PNG ou WebP, até 2 MB);
- banco de mensagens por pessoa;
- criação de momentos com mensagem aleatória;
- registros de agradecimentos;
- respostas sem cache e CORS configurável;
- deploy serverless na Vercel.

## Desenvolvimento

```bash
cp .env.example .env
npm install
npm run dev
```

Healthcheck:

```text
GET /api/health
```

As demais rotas exigem `Authorization: Bearer <Firebase ID token>`.

## Rotas

```text
GET    /api/people
POST   /api/people
GET    /api/people/:id
PATCH  /api/people/:id
POST   /api/people/:id/messages
POST   /api/people/:id/moments
POST   /api/people/:id/invitations
GET    /api/invitations/:token
POST   /api/invitations/:token/accept
GET    /api/thanks
POST   /api/thanks
DELETE /api/thanks/:id
```
