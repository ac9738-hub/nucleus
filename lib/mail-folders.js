'use strict'

const FOLDER_LABELS = {
  inbox: 'INBOX',
  secondary: 'INBOX',
  starred: 'STARRED',
  sent: 'SENT',
  drafts: 'DRAFT',
  spam: 'SPAM',
  trash: 'TRASH'
}

const MAIL_FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: 'IN' },
  { id: 'secondary', label: 'Secondary Inbox', icon: '2°' },
  { id: 'starred', label: 'Starred', icon: '★' },
  { id: 'sent', label: 'Sent', icon: '→' },
  { id: 'drafts', label: 'Drafts', icon: '✎' },
  { id: 'spam', label: 'Spam', icon: '!' },
  { id: 'trash', label: 'Trash', icon: '⌫' }
]

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FOLDER_LABELS, MAIL_FOLDERS }
}

if (typeof window !== 'undefined') {
  window.NucleusMailFolders = { FOLDER_LABELS, MAIL_FOLDERS }
}
