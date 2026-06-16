// Canvas interactive auth capture.
// Functionality: opens an Electron auth WebContentsView and captures Canvas
// cookies/CSRF/base URL from authenticated API requests.
// Dependencies: main.js owns the view lifecycle callbacks and persists auth via
// app/canvas/api.js after setup.
const { WebContentsView } = require('electron')

module.exports = {
  open_canvas_auth_window,
  get_auth_token,
  get_auth_csrf,
  get_base_url,
  clear_auth_state
}

let authtoken = null
let csrf = null
let base_url = null
let called = false

const filter = {
  urls: ['*://*/api/v1/*']
}

function getHeader(headers, name) {
    const target = name.toLowerCase()
    const key = Object.keys(headers).find(item => item.toLowerCase() === target)
    return key ? headers[key] : null
}

function isCanvasApiHost(hostname) {
    const host = String(hostname || '').toLowerCase()
    return host.includes('instructure.com') || host.includes('canvas')
}

async function isInstitutionalCanvasPage(view) {
    if (!view || view.webContents.isDestroyed()) return false

    try {
        const result = await view.webContents.executeJavaScript(`
            (() => {
                const markers = [
                    !!document.querySelector("#application"),
                    !!document.querySelector(".ic-app-main-content"),
                    !!document.querySelector("#content-wrapper"),
                    !!document.querySelector("#global_nav_profile_link"),
                    !!document.querySelector("[data-api-endpoint*='/api/v1/']"),
                    typeof window.ENV === "object" && !!window.ENV,
                    typeof window.INST === "object" && !!window.INST
                ];

                return markers.filter(Boolean).length >= 2;
            })();
        `, true)

        return Boolean(result)
    } catch (error) {
        console.error("Unable to inspect Canvas auth page:", error)
        return false
    }
}

// Opens the one interactive auth surface. main.js supplies callbacks so this
// module never owns app state beyond the captured token fields below.
function open_canvas_auth_window (window, onauth, getauthview, setup = false) {
    const [contentWidth, contentHeight] = window.getContentSize()
    const view = new WebContentsView()
    view.webContents.setWindowOpenHandler(({ url }) => {
        view.webContents.loadURL(url);
        return { action: 'deny' };
    });
    const ses = view.webContents.session
    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        callback({ requestHeaders: details.requestHeaders })

        if (called) return

        let host = ''
        try {
            host = new URL(details.url).hostname
        } catch (_error) {
            return
        }
        if (!isCanvasApiHost(host)) return

        const requestOrigin = new URL(details.url).origin

        isInstitutionalCanvasPage(view).then(isCanvasPage => {
            if (called || !isCanvasPage) return
            called = true

            const turl = requestOrigin
            const token = getHeader(details.requestHeaders, 'Cookie')
            const tcsrf = getHeader(details.requestHeaders, 'x-csrf-token')
             window.contentView.removeChildView(view)
             getauthview(null)
            if (tcsrf) {
                console.log('csrf:' + tcsrf)
                csrf = tcsrf
            }
            if (turl) {
                base_url = turl
            }
            if (token) {
                authtoken = token
                if (base_url){
                    onauth()
                    if(setup) {
                        Promise.resolve(setup()).catch(error => {
                            console.error("Canvas setup failed:", error)
                        })
                    }
                }
            }
        }).catch(error => {
            console.error("Unable to process Canvas auth interception:", error)
        })
    })
    view.webContents.loadURL("https://www.instructure.com/canvas/login")
    view.setBounds({
        x: 220,
        y: 0,
        width: Math.max(0, contentWidth - 340 - 220),
        height: Math.max(0, contentHeight)
    })
    window.contentView.addChildView(view)
    getauthview(view)
    
    called = false
}

function get_auth_token(){
    if (!authtoken) {
        return null
    }
    return authtoken
}

function get_auth_csrf(){
    if(!csrf) {
        return null
    }
    return csrf
}

function get_base_url() {
    if(!base_url) {
        return null
    }
    return base_url
}

function clear_auth_state() {
    authtoken = null
    csrf = null
    base_url = null
    called = false
}
