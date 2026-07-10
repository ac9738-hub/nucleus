const fs = require('fs')
const path = require('path')
const { openPlatformAuthWindow } = require('../auth-capture')

const GRADESCOPE_AUTH_PATH = path.join(__dirname, '..', '..', '..', 'gradescope_auth.json')

function readGradescopeAuth() {
  if (!fs.existsSync(GRADESCOPE_AUTH_PATH)) return null
  try {
    return JSON.parse(fs.readFileSync(GRADESCOPE_AUTH_PATH, 'utf8'))
  } catch (error) {
    console.error('Unable to read Gradescope auth:', error)
    return null
  }
}

function saveGradescopeAuth(auth) {
  fs.writeFileSync(GRADESCOPE_AUTH_PATH, JSON.stringify(auth, null, 2))
}

function openGradescopeAuthWindow(window, onAuth, getAuthView) {
  return openPlatformAuthWindow(window, {
    loginUrl: 'https://www.gradescope.com/',
    allowedPopupHosts: ['gradescope.com'],
    urlFilter: ['*://*.gradescope.com/*'],
    onAuth: auth => {
      const payload = {
        cookie: auth.cookie,
        csrf: auth.csrf,
        origin: auth.origin || 'https://www.gradescope.com',
        captured_at: new Date().toISOString()
      }
      saveGradescopeAuth(payload)
      onAuth(payload)
    },
    getAuthView,
    validatePage: async view => {
      try {
        return await view.webContents.executeJavaScript(`
          (() => {
            const markers = [
              !!document.querySelector('a[href*="/account"]'),
              !!document.querySelector('.courseList'),
              !!document.querySelector('.course-box'),
              !!document.querySelector('[data-react-class]'),
              document.cookie.includes('_gradescope_session')
            ]
            return markers.filter(Boolean).length >= 1
          })()
        `, true)
      } catch (error) {
        return false
      }
    }
  })
}

module.exports = {
  GRADESCOPE_AUTH_PATH,
  readGradescopeAuth,
  saveGradescopeAuth,
  openGradescopeAuthWindow
}
