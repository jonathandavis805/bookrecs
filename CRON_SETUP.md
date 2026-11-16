# Cron job setup

To automatically clean up rejected accounts after the grace period, set up a cron job to call the cleanup endpoint:

```
POST https://bookrecs.dev/api/admin/cleanup-rejected
```

## Option 1: Using cron-job.org (free)

1. Sign up at https://cron-job.org
2. Create a new cron job
3. Set URL: `https://bookrecs.dev/api/admin/cleanup-rejected`
4. Set method: POST
5. Set schedule: daily (or weekly)
6. Add header: `Authorization: Bearer YOUR_ADMIN_TOKEN`

## Option 2: Using Cloudflare Worker CRON trigger

Create a separate Worker with CRON trigger that calls the cleanup endpoint.

## Option 3: Manual cleanup

You can manually run the cleanup by calling the endpoint with curl:

```bash
curl -X POST https://bookrecs.dev/api/admin/cleanup-rejected \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## What it does

- Deletes users with status='rejected' who were rejected more than 7 days ago
- Returns the number of deleted users
- Only accessible to admin users
