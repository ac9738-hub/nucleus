const fs = require('fs')
const path = require('path')
const { webFrame } = require('electron')

const criticalInjection = `
  html,
  body {
    background: #181a1f !important;
  }

  body,
  #application,
  .ic-app,
  .ic-Layout-wrapper,
  .ic-app-main-content,
  .ic-Layout-contentWrapper {
    background-color: #181a1f !important;
  }
`

webFrame.insertCSS(criticalInjection)

if (document.documentElement) {
  document.documentElement.style.backgroundColor = '#181a1f'
}

if (document.body) {
  document.body.style.backgroundColor = '#181a1f'
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.style.backgroundColor = '#181a1f'
  }, { once: true })
}

const injection = fs.readFileSync(path.join(__dirname, '..', '..', 'injection.css'), 'utf-8')

webFrame.insertCSS(injection)
