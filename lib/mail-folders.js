'use strict'

const FOLDER_LABELS = {
  inbox: 'INBOX',
  secondary: 'INBOX',
  campus_events: 'INBOX',
  starred: 'STARRED',
  sent: 'SENT',
  drafts: 'DRAFT',
  spam: 'SPAM',
  trash: 'TRASH'
}

const MAIL_FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox', labelId: 'INBOX' },
  { id: 'campus_events', label: 'Campus Events', icon: 'campus_events', labelId: 'INBOX' },
  { id: 'secondary', label: 'Secondary', icon: 'secondary', labelId: 'INBOX' },
  { id: 'starred', label: 'Starred', icon: 'starred', labelId: 'STARRED' },
  { id: 'sent', label: 'Sent', icon: 'sent', labelId: 'SENT' },
  { id: 'drafts', label: 'Drafts', icon: 'drafts', labelId: 'DRAFT' },
  { id: 'spam', label: 'Spam', icon: 'spam', labelId: 'SPAM' },
  { id: 'trash', label: 'Trash', icon: 'trash', labelId: 'TRASH' }
]

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FOLDER_LABELS, MAIL_FOLDERS }
}

if (typeof window !== 'undefined') {
  window.NucleusMailFolders = { FOLDER_LABELS, MAIL_FOLDERS }
}
