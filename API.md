# License API Documentation

Base URL: `http://localhost:3000/api`

## Authentication

Currently no authentication is required. Add API key authentication or JWT in production.

## Endpoints

### Health Check

```http
GET /health
```

Returns server health status.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-10T12:00:00.000Z",
  "uptime": 123.456
}
```

---

### Create License

```http
POST /api/licenses
```

Generate a new license key for a user and product.

**Request Body:**
```json
{
  "userId": "uuid",
  "productId": "uuid",
  "expiresAt": "2025-12-31T23:59:59.000Z",  // optional
  "maxActivations": 5,  // optional, default: 1
  "metadata": {         // optional
    "custom": "data"
  },
  "notes": "License for premium plan"  // optional
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "productId": "uuid",
  "licenseKey": "ABCD-EFGH-IJKL-MNOP",
  "status": "ACTIVE",
  "issuedAt": "2025-01-10T12:00:00.000Z",
  "expiresAt": "2025-12-31T23:59:59.000Z",
  "activatedAt": null,
  "revokedAt": null,
  "maxActivations": 5,
  "currentActivations": 0,
  "metadata": { "custom": "data" },
  "notes": "License for premium plan",
  "createdAt": "2025-01-10T12:00:00.000Z",
  "updatedAt": "2025-01-10T12:00:00.000Z",
  "user": { ... },
  "product": { ... }
}
```

---

### Validate License

```http
POST /api/licenses/validate
```

Validate a license key and log the validation attempt.

**Request Body:**
```json
{
  "licenseKey": "ABCD-EFGH-IJKL-MNOP",
  "deviceFingerprint": "device-123"  // optional
}
```

**Response 200:**
```json
{
  "valid": true,
  "message": "License is valid",
  "license": {
    "id": "uuid",
    "licenseKey": "ABCD-EFGH-IJKL-MNOP",
    "status": "ACTIVE",
    // ... full license details
  }
}
```

**Validation Rules:**
- ✅ License must exist
- ✅ Status must be ACTIVE (not REVOKED, SUSPENDED)
- ✅ Must not be expired
- ✅ Current activations < max activations
- ✅ Auto-increments activation count on first use

**Invalid Response:**
```json
{
  "valid": false,
  "message": "License has expired",
  "license": null
}
```

---

### Get License by Key

```http
GET /api/licenses/key/:licenseKey
```

Retrieve license details by license key.

**Response 200:**
```json
{
  "id": "uuid",
  "licenseKey": "ABCD-EFGH-IJKL-MNOP",
  "status": "ACTIVE",
  // ... full license details with user, product, and validations
}
```

**Response 404:**
```json
{
  "error": "License not found"
}
```

---

### Get License by ID

```http
GET /api/licenses/:id
```

Retrieve license details by ID.

**Response 200:**
```json
{
  "id": "uuid",
  "licenseKey": "ABCD-EFGH-IJKL-MNOP",
  // ... full license details
}
```

---

### List Licenses

```http
GET /api/licenses?userId=uuid&productId=uuid&status=ACTIVE&limit=50&offset=0
```

List licenses with optional filters.

**Query Parameters:**
- `userId` (optional): Filter by user UUID
- `productId` (optional): Filter by product UUID
- `status` (optional): Filter by status (ACTIVE, EXPIRED, REVOKED, SUSPENDED)
- `limit` (optional): Number of results (1-100, default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response 200:**
```json
{
  "licenses": [
    {
      "id": "uuid",
      "licenseKey": "ABCD-EFGH-IJKL-MNOP",
      // ... license details
    }
  ],
  "total": 42
}
```

---

### Update License

```http
PATCH /api/licenses/:id
```

Update license details.

**Request Body:**
```json
{
  "status": "SUSPENDED",  // optional: ACTIVE, EXPIRED, REVOKED, SUSPENDED
  "expiresAt": "2026-12-31T23:59:59.000Z",  // optional
  "maxActivations": 10,  // optional
  "notes": "Extended license"  // optional
}
```

**Response 200:**
```json
{
  "id": "uuid",
  "licenseKey": "ABCD-EFGH-IJKL-MNOP",
  // ... updated license details
}
```

---

### Revoke License

```http
POST /api/licenses/:id/revoke
```

Revoke a license (sets status to REVOKED).

**Request Body:**
```json
{
  "reason": "User requested cancellation"  // optional
}
```

**Response 200:**
```json
{
  "id": "uuid",
  "status": "REVOKED",
  "revokedAt": "2025-01-10T12:00:00.000Z",
  // ... license details
}
```

---

### Delete License

```http
DELETE /api/licenses/:id
```

Permanently delete a license and all its validation records.

**Response 204:** No content

**Response 404:**
```json
{
  "error": "License not found"
}
```

---

## Status Values

| Status | Description |
|--------|-------------|
| `ACTIVE` | License is valid and can be used |
| `EXPIRED` | License has passed its expiration date |
| `REVOKED` | License has been manually revoked |
| `SUSPENDED` | License is temporarily suspended |

## Rate Limiting

- **Limit**: 100 requests per minute
- **Header**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Error Responses

**400 Bad Request:**
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation error details"
}
```

**404 Not Found:**
```json
{
  "error": "License not found"
}
```

**429 Too Many Requests:**
```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded"
}
```

**500 Internal Server Error:**
```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "Error details"
}
```

## Example Usage

### Generate a License

```bash
curl -X POST http://localhost:3000/api/licenses \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "productId": "product-uuid-here",
    "expiresAt": "2025-12-31T23:59:59.000Z",
    "maxActivations": 5
  }'
```

### Validate a License

```bash
curl -X POST http://localhost:3000/api/licenses/validate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "ABCD-EFGH-IJKL-MNOP",
    "deviceFingerprint": "device-123"
  }'
```

### List Active Licenses

```bash
curl "http://localhost:3000/api/licenses?status=ACTIVE&limit=10"
```

### Revoke a License

```bash
curl -X POST http://localhost:3000/api/licenses/<license-id>/revoke \
  -H "Content-Type: application/json" \
  -d '{"reason": "User requested cancellation"}'
```

## Next Steps

1. **Add Authentication**: Implement API key or JWT authentication
2. **Webhooks**: Add webhook notifications for license events
3. **Admin Dashboard**: Build a UI for managing licenses
4. **Analytics**: Track license usage and validation patterns
5. **Export**: Add CSV/Excel export for license data
