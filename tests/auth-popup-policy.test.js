'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const {
  handleTrustedAuthPopup,
  isCanvasLikeHostname,
  isTrustedAuthPopupUrl
} = require('../app/platforms/auth-popup-policy')

function loadWithElectronMock(modulePath, factory) {
  const resolved = require.resolve(modulePath)
  const originalLoad = Module._load
  delete require.cache[resolved]
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { WebContentsView: factory }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

test('auth popup policy rejects unsafe schemes and unrelated hosts', () => {
  const options = {
    loginUrl: 'https://www.gradescope.com/',
    allowedHosts: ['gradescope.com']
  }

  assert.equal(isTrustedAuthPopupUrl('javascript:alert(1)', options), false)
  assert.equal(isTrustedAuthPopupUrl('file:///tmp/fake-login.html', options), false)
  assert.equal(isTrustedAuthPopupUrl('https://evil.example/login', options), false)
})

test('auth popup policy permits HTTPS login host subdomains', () => {
  const options = {
    loginUrl: 'https://www.gradescope.com/',
    allowedHosts: ['gradescope.com']
  }

  assert.equal(isTrustedAuthPopupUrl('https://www.gradescope.com/login', options), true)
  assert.equal(isTrustedAuthPopupUrl('https://help.gradescope.com/oauth', options), true)
})

test('auth popup policy recognizes common Canvas institutional hosts', () => {
  assert.equal(isCanvasLikeHostname('school.instructure.com'), true)
  assert.equal(isCanvasLikeHostname('canvas.harvard.edu'), true)
  assert.equal(isCanvasLikeHostname('evilcanvas.example'), false)
})

test('auth popup handler denies untrusted popups without loading them', () => {
  const loaded = []
  const webContents = {
    loadURL(url) {
      loaded.push(url)
    }
  }

  const result = handleTrustedAuthPopup(webContents, 'https://evil.example/login', {
    loginUrl: 'https://www.gradescope.com/',
    allowedHosts: ['gradescope.com']
  })

  assert.deepEqual(result, { action: 'deny' })
  assert.deepEqual(loaded, [])
})

test('auth popup handler keeps trusted HTTPS auth popups in the auth view', () => {
  const loaded = []
  const webContents = {
    loadURL(url) {
      loaded.push(url)
      return Promise.resolve()
    }
  }

  const result = handleTrustedAuthPopup(webContents, 'https://www.gradescope.com/oauth', {
    loginUrl: 'https://www.gradescope.com/',
    allowedHosts: ['gradescope.com']
  })

  assert.deepEqual(result, { action: 'deny' })
  assert.deepEqual(loaded, ['https://www.gradescope.com/oauth'])
})

test('shared platform auth window does not load untrusted popup URLs', () => {
  const loaded = []
  const handlers = []
  class MockWebContentsView {
    constructor() {
      this.webContents = {
        session: {
          webRequest: {
            onBeforeSendHeaders() {}
          }
        },
        setWindowOpenHandler(handler) {
          handlers.push(handler)
        },
        loadURL(url) {
          loaded.push(url)
          return Promise.resolve()
        }
      }
    }
  }

  const { openPlatformAuthWindow } = loadWithElectronMock('../app/platforms/auth-capture', MockWebContentsView)
  openPlatformAuthWindow({
    contentView: {
      addChildView() {}
    }
  }, {
    loginUrl: 'https://www.gradescope.com/',
    allowedPopupHosts: ['gradescope.com'],
    urlFilter: ['*://*.gradescope.com/*'],
    onAuth() {},
    getAuthView() {}
  })

  assert.deepEqual(loaded, ['https://www.gradescope.com/'])
  assert.deepEqual(handlers[0]({ url: 'https://evil.example/login' }), { action: 'deny' })
  assert.deepEqual(loaded, ['https://www.gradescope.com/'])
  assert.deepEqual(handlers[0]({ url: 'https://www.gradescope.com/oauth' }), { action: 'deny' })
  assert.deepEqual(loaded, ['https://www.gradescope.com/', 'https://www.gradescope.com/oauth'])
})
