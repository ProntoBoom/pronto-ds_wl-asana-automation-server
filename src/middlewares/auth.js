// For page navigations — an expired session should land on the login page
function checkAuthenticated (req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.redirect('/login')
}

// For fetch/XHR API routes — a redirect would hand HTML to res.json() and
// blank the page; answer 401 instead and let the front-end route to /login
function checkAuthenticatedAPI (req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({ message: 'Session expired' })
}

const authenticateAPI = (req, res, next) => {
  const apiKey = req.headers['x-api-key']

  if (!apiKey) {
    return res.status(401).json({ message: 'Unauthorized' })
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Unauthorized' })
  }

  next()
}

export { checkAuthenticated, checkAuthenticatedAPI, authenticateAPI }
