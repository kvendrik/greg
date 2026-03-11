# Getting Started with the Company API

Welcome to the Company API documentation. This guide will help you integrate with our platform and start building.

## Overview

The Company API is a RESTful API that lets you manage users, projects, and billing. All requests use HTTPS and JSON for request and response bodies. Authentication is done via API keys or OAuth 2.0.

**Base URL:** `https://api.company.com/v2`  
**Documentation:** `https://docs.company.com`  
**Status page:** `https://status.company.com`

## Authentication

### API keys

Create an API key in the [dashboard](https://app.company.com/settings/api-keys). Include it in the `Authorization` header:

```
Authorization: Bearer sk_live_xxxxxxxxxxxx
```

Keep your keys secret. Do not commit them to version control. Use environment variables in production.

### OAuth 2.0

For user-facing apps, use OAuth 2.0. See our [OAuth guide](https://docs.company.com/oauth) for authorization URL, scopes, and token exchange.

## Rate limits

| Tier    | Requests/minute |
|---------|-----------------|
| Free    | 60              |
| Pro     | 300             |
| Enterprise | Custom       |

Responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers. When you exceed the limit, you receive `429 Too Many Requests` and a `Retry-After` header.

## Common endpoints

### List users

```http
GET /users
```

Returns a paginated list of users in your workspace. Supports `limit` and `offset` query parameters.

### Create a project

```http
POST /projects
Content-Type: application/json

{
  "name": "My Project",
  "region": "us-east-1"
}
```

### Webhooks

Configure webhooks in the dashboard to receive events (e.g. `user.created`, `project.updated`). We send a signed payload; verify it using the secret shown in the dashboard. See [Webhooks](https://docs.company.com/webhooks) for payload shapes and retry behavior.

## SDKs and tools

Official SDKs are available for:

- [JavaScript / TypeScript](https://github.com/company/sdk-js)
- [Python](https://github.com/company/sdk-python)
- [Go](https://github.com/company/sdk-go)

We also provide a [Postman collection](https://www.postman.com/company/workspace) and an [OpenAPI spec](https://api.company.com/openapi.json).

## Support

- **Docs:** [docs.company.com](https://docs.company.com)  
- **Community:** [community.company.com](https://community.company.com)  
- **Email:** api-support@company.com  
- **Status:** [status.company.com](https://status.company.com)

---

*Last updated: November 2024. For the latest changes, see the [changelog](https://docs.company.com/changelog).*
