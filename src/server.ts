import app from './app.js'
import { config } from './config.js'

app.listen(config.port, () => {
  console.log(`Apenas Para Dizer API em http://localhost:${config.port}`)
})
