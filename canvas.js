const {BrowserWindow, WebContentsView} = require('electron')

module.exports = { open_canvas_auth_window, get_auth_token, get_auth_csrf, get_base_url }

let authtoken = null
let csrf = null
let base_url = null
let called = false

const filter = {
  urls: ['*://*.instructure.com/api/v1/*']
}
// need to add error handling for unsuccessful retrieval of api calls
function open_canvas_auth_window (window, onath, getauthview, setup = false) {
    const [winwidth, winheight] = window.getSize()
    view = new WebContentsView()
    view.webContents.setWindowOpenHandler(({ url }) => {
        view.webContents.loadURL(url);
        return { action: 'deny' };
    });
    const ses = view.webContents.session
    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        if (!called) {
            called = true
            console.log('intercepted api call' + JSON.stringify(details.requestHeaders))
            turl = new URL(details.url).origin
            token = details.requestHeaders['Cookie']
            tcsrf = details.requestHeaders['x-csrf-token']
            console.log('window closed')
            window.contentView.removeChildView(view)
            getauthview(null)
            callback({ requestHeaders: details.requestHeaders })
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
                if (csrf){
                    onath()
                    console.log('got to setup')
                    if(setup) {
                        console.log('setup ran')
                        setup()
                    }
                }
            }
            }
    })
    view.webContents.loadURL("https://www.instructure.com/canvas/login")
    console.log('opened window')
    view.setBounds({ x: 220, y: 120, width: winwidth - 340 - 220, height: winheight})
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