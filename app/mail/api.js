const { shell } = require('electron')
const http = require('http')
const { google } = require('googleapis')
const {BrowserWindow} = require('electron')
let token = null

const oauth2Client = new google.auth.OAuth2(
    '184291192111-g8r7ul70jbvn0jhsv64ums89q47udebb.apps.googleusercontent.com',
    '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', 
    'http://localhost:3000/callback'
)

async function creategmailauthview() {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify'
        ]
    })

    console.log("gmail api: " + authUrl)

    const authview = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false
        }
    })

    authview.webContents.on('will-redirect', (event, url) => {
        if (url.startsWith('http://localhost:3000/callback')) {
            console.log("Received callback")
        }
    })

    authview.loadURL(authUrl)
    console.log("awaiting callback")
    token = await startCallbackServer(authview)
    return token
}

async function startCallbackServer(authview) {
    console.log("Starting callback server...")
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            console.log("Received request")
        const url = new URL(req.url, 'http://localhost:3000/')
        const code = url.searchParams.get('code')
        if (code) {
            const { tokens } = await oauth2Client.getToken(code)
            oauth2Client.setCredentials(tokens)

            res.end('Auth complete, you can close this window.')
            server.close()
            authview.close()
            resolve(tokens)
        }
        })

        server.listen(3000)
    })
}

function get_token() {
    if (token) {
        console.log("Using existing token" + token.access_token)
        return token.access_token  // return just the access token string
    }
    return null
}

async function getmail() {
    console.log("Fetching mail...")
    const authtoken = get_token()
    if (!authtoken) {
        return "No token available"
    }
    const mail = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=20', {
        headers: {
            'Authorization': `Bearer ${authtoken}`
        }
    })

    const maildata = await mail.json()
    console.log(maildata)
    return maildata
}

module.exports = {
    creategmailauthview,
    get_token,
    getmail,
    getmailmeta
}

async function getmailmeta(id, threadid) {
    console.log("Fetching mail metadata...")
    const authtoken = get_token()
    if (!authtoken) {
        return "No token available"
    }
    const mail = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata`, {
        headers: {
            'Authorization': `Bearer ${authtoken}`
        }
    })

    const maildata = await mail.json()
    console.log(maildata)
    return maildata
}