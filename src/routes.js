import path from 'path'
import { fileURLToPath } from 'url'
import healthcheckRouter from './api/healthcheck/index.js'
import webhookRouter from './api/webhook/index.js'
import authRouter from './api/auth/index.js'
import uiRouter from './api/ui/index.js'
import { checkAuthenticated, checkAuthenticatedAPI } from './middlewares/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Pages must always be revalidated — a cached page served after the session
// expired runs its JS against a dead session and renders blank
function sendPage (res, file) {
  res.set('Cache-Control', 'no-store')
  res.sendFile(path.join(__dirname, `../public/${file}`))
}

function routes (app) {
  app.use('/auth', authRouter)
  app.use('/api/healthcheck', healthcheckRouter)
  app.use('/api/webhook', webhookRouter)
  app.use('/ui', checkAuthenticatedAPI, uiRouter)

  app.get('/login', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/')
    sendPage(res, 'login.html')
  })

  app.get('/', checkAuthenticated, (req, res) => {
    sendPage(res, 'index.html')
  })

  app.get('/register', checkAuthenticated, (req, res) => {
    sendPage(res, 'register.html')
  })
}

export default routes
