# Fleet API — 60-second check

If you are seeing an authentication error, run **this exact command first**.
It tells us in one step whether the key works.

```bash
curl -i -H "x-api-key: W6ZblbIF4Z4pK5VIZe4bMAizWeYBSpqdncczRlzH" \
  https://api.energize-logistics.com/api/fleet-api/health
```

**Expected — this is what a working key returns:**

```
HTTP/1.1 200 OK
{"ok":true,"generatedAt":"...","pollHealthy":true,"newestReadingAgeSeconds":14}
```

If you get that, the key is fine and the problem is in your client code — see
*Common mistakes* below.

---

## What our errors actually look like

Our API only ever returns these. **If your error message is not one of these, you
are not talking to our API.**

| Status | Body |
|---|---|
| `401` | `{"message":"مفتاح غير صالح","code":"INVALID_API_KEY"}` |
| `404` | `{"message":"المركبة غير موجودة"}` |
| `503` | `{"message":"...","code":"API_KEY_NOT_CONFIGURED"}` |

> **"Authentication failed — please check your credentials" is not one of ours.**
> That message comes from somewhere else. Most likely you are pointing at the
> Location Solutions / Wialon platform instead of our API. You do **not** need a
> Location Solutions account — we read from them and re-serve the data to you.
> The only credential you need is the `x-api-key` above.

---

## Common mistakes

| Mistake | What happens |
|---|---|
| `Authorization: Bearer <key>` | **401** — we use `x-api-key`, not Bearer |
| Missing `/api` in the path | **404** |
| `http://` instead of `https://` | connection refused / redirect |
| Key copied with a trailing space or newline | **401** — trim it |
| Logging in to Location Solutions | not our API at all |

**Correct base URL:**
```
https://api.energize-logistics.com/api/fleet-api
```
Note `api.` at the front — that is the API host, not the website.

---

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /health` | key check + whether the tracking feed is alive |
| `GET /vehicles` | all vehicles, full live snapshot |
| `GET /vehicles/:plate` | one vehicle |
| `GET /alerts` | open alerts |

Full field reference: **FLEET-API.md**

---

## Node.js starter

```javascript
const KEY = process.env.FLEET_API_KEY;   // keep it out of source
const BASE = 'https://api.energize-logistics.com/api/fleet-api';

const res = await fetch(`${BASE}/health`, { headers: { 'x-api-key': KEY } });
console.log(res.status, await res.json());
```

## Python starter

```python
import os, requests
KEY = os.environ["FLEET_API_KEY"]
BASE = "https://api.energize-logistics.com/api/fleet-api"

r = requests.get(f"{BASE}/health", headers={"x-api-key": KEY}, timeout=20)
print(r.status_code, r.json())
```

---

## Still failing?

Send us the output of the `curl -i` command at the top — the **status line and
body**, not a screenshot of your app's error. That tells us immediately whether
the request reached us at all.
