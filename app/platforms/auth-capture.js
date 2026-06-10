const { WebContentsView } = require('electron')

function getHeader(headers, name) {
  const target = name.toLowerCase()
  const key = Object.keys(headers).find(item => item.toLowerCase() === target)
  return key ? headers[key] : null
}

function openPlatformAuthWindow(window, {
  loginUrl,
  urlFilter,
  onAuth,
  getAuthView,
  validatePage = async () => true
}) {
  const view = new WebContentsView()
  let captured = false

  view.webContents.setWindowOpenHandler(({ url }) => {
    view.webContents.loadURL(url)
    return { action: 'deny' }
  })

  const session = view.webContents.session
  session.webRequest.onBeforeSendHeaders({ urls: urlFilter }, (details, callback) => {
    callback({ requestHeaders: details.requestHeaders })
    if (captured) return

    validatePage(view).then(isValid => {
      if (!isValid || captured) return
      captured = true
      const cookie = getHeader(details.requestHeaders, 'Cookie')
      const csrf = getHeader(details.requestHeaders, 'x-csrf-token')
      window.contentView.removeChildView(view)
      getAuthView(null)
      onAuth({
        cookie: cookie || '',
        csrf: csrf || '',
        origin: new URL(details.url).origin
      })
    }).catch(error => {
      console.error('Platform auth validation failed:', error)
    })
  })

  window.contentView.addChildView(view)
  getAuthView(view)
  view.webContents.loadURL(loginUrl)
  return view
}

module.exports = {
  openPlatformAuthWindow
}
