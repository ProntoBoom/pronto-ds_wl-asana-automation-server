import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import morgan from 'morgan'
import session from 'express-session'
import sessionFileStore from 'session-file-store'
import passport from './passport.js'
import routes from '../routes.js'
import { asanaConfig } from './asana.js'
import { syncWebhooksFromAsana } from '../util/syncWebhooks.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function configExpress (app) {
  app.set('trust proxy', 1)
  app.use(morgan('dev'))
  app.use(express.json())
  // index: false — otherwise static serves index.html for "/" before the
  // auth middleware ever runs, handing the dashboard shell to logged-out
  // users (whose API calls then fail and blank the page)
  app.use(express.static(path.join(__dirname, '../../public'), { index: false }))

  const SESSION_TTL_DAYS = 7
  const FileStore = sessionFileStore(session)

  app.use(session({
    // File-backed store on ./db (the persistent disk in production) so
    // sessions survive restarts/redeploys — the in-memory default wiped
    // every session on deploy
    store: new FileStore({
      path: './db/sessions',
      ttl: SESSION_TTL_DAYS * 24 * 60 * 60,
      logFn: () => {} // silence per-request noise; errors still surface via express-session
    }),
    secret: process.env.SECRET_SESSION,
    resave: false,
    saveUninitialized: false,
    rolling: true, // refresh the cookie on activity so active users stay logged in
    cookie: {
      secure: process.env.ENV === 'prod',
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
    }
  }))

  app.use(passport.initialize())
  app.use(passport.session())

  asanaConfig()
  routes(app)
  syncWebhooksFromAsana()
}

export default configExpress
