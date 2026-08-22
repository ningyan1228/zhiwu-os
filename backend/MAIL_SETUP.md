# Zhiwu OS Mail Center server setup

Mail Center reads one mailbox through IMAP. Keep every value below only in the
server file `~/projects/zhiwu-os-proxy/backend/.env`; never commit it or put it
in GitHub Pages.

```dotenv
MAIL_HOST=imap.qiye.aliyun.com
MAIL_PORT=993
MAIL_USERNAME=your-business-email@example.com
MAIL_PASSWORD=your-server-only-imap-password-or-app-password
MAIL_FOLDER=INBOX
MAIL_OWNER_USER_ID=your-supabase-auth-user-id
MAIL_SYNC_INTERVAL_SECONDS=600
MAIL_SYNC_MAX_MESSAGES=100
```

`MAIL_OWNER_USER_ID` is the Supabase user that owns the CRM workspace. The
mail-sync service runs every 10 minutes, reads only messages, and writes the
email metadata/body into Supabase. It never sends mail or exposes IMAP
credentials to the browser.
