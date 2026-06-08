const {BrowserWindow, WebContentsView} = require('electron')

module.exports = { open_canvas_auth_window, get_auth_token, get_auth_csrf, get_base_url }

let authtoken = null
let csrf = null
let base_url = null
let called = false

const filter = {
  urls: ['*://*.instructure.com/api/v1/*']
}

function getHeader(headers, name) {
    const target = name.toLowerCase()
    const key = Object.keys(headers).find(item => item.toLowerCase() === target)
    return key ? headers[key] : null
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

// need to add error handling for unsuccessful retrieval of api calls
function open_canvas_auth_window (window, onath, getauthview, setup = false) {
    const [contentWidth, contentHeight] = window.getContentSize()
    view = new WebContentsView()
    view.webContents.setWindowOpenHandler(({ url }) => {
        view.webContents.loadURL(url);
        return { action: 'deny' };
    });
    const ses = view.webContents.session
    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        callback({ requestHeaders: details.requestHeaders })

        if (!called) {
            const requestOrigin = new URL(details.url).origin

            isInstitutionalCanvasPage(view).then(isCanvasPage => {
                if (called || !isCanvasPage) return
                called = true

            turl = requestOrigin
            token = getHeader(details.requestHeaders, 'Cookie')
            tcsrf = getHeader(details.requestHeaders, 'x-csrf-token')
             console.log('window closed')
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
                console.log(csrf)
                if (base_url){
                    onath()
                    console.log('got to setup')
                    if(setup) {
                        console.log('setup ran')
                        Promise.resolve(setup()).catch(error => {
                            console.error("Canvas setup failed:", error)
                        })
                    }
                }
            }
            }).catch(error => {
                console.error("Unable to process Canvas auth interception:", error)
            })
        }
    })
    view.webContents.loadURL("https://www.instructure.com/canvas/login")
    console.log('opened window')
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
