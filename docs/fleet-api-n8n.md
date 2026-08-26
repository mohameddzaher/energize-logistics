# Fleet API in n8n — setup and a ready workflow

> **If you are seeing "Authentication failed — please check your credentials":**
> that is n8n's own message, not ours. It means the **Authentication** setting on
> the HTTP Request node is wrong. Our API does not use Basic Auth or Bearer
> tokens — it uses a plain header called `x-api-key`. Fix below.

---

## The fix (30 seconds)

In your **HTTP Request** node:

1. **Authentication** → leave it as **None**
2. Turn on **Send Headers**
3. **Header Parameters** → Add:
   - **Name:** `x-api-key`
   - **Value:** `W6ZblbIF4Z4pK5VIZe4bMAizWeYBSpqdncczRlzH`
4. **URL:** `https://api.energize-logistics.com/api/fleet-api/vehicles`
5. **Method:** GET

That is all. No credential type, no OAuth, no login.

**If you prefer a reusable credential** (so the key is not visible in the node):
**Authentication** → **Generic Credential Type** → **Header Auth** → create a
credential with **Name** `x-api-key` and **Value** = the key.

> Do **not** pick *Basic Auth*, *Bearer*, or any *Predefined Credential Type* —
> each of those produces exactly the error you saw.

---

## Ready-to-import workflow

Save the JSON below as `fleet-tyre-alerts.json` and use **Workflows → Import from File**.

It polls every 5 minutes, skips stale readings and faulty sensors, and outputs
one item per problem tyre — ready to wire into Slack, email, or a ticket node.

```json
{
  "name": "Fleet — tyre alerts",
  "nodes": [
    {
      "parameters": { "rule": { "interval": [ { "field": "minutes", "minutesInterval": 5 } ] } },
      "id": "schedule",
      "name": "Every 5 minutes",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [ -200, 0 ]
    },
    {
      "parameters": {
        "url": "https://api.energize-logistics.com/api/fleet-api/health",
        "sendHeaders": true,
        "headerParameters": { "parameters": [ { "name": "x-api-key", "value": "={{ $env.FLEET_API_KEY }}" } ] },
        "options": { "timeout": 20000 }
      },
      "id": "health",
      "name": "Check feed is alive",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [ 20, 0 ]
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "version": 2 },
          "conditions": [
            { "leftValue": "={{ $json.pollHealthy }}", "rightValue": true, "operator": { "type": "boolean", "operation": "true", "singleValue": true } }
          ],
          "combinator": "and"
        }
      },
      "id": "gate",
      "name": "Feed healthy?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [ 240, 0 ]
    },
    {
      "parameters": {
        "url": "https://api.energize-logistics.com/api/fleet-api/vehicles",
        "sendHeaders": true,
        "headerParameters": { "parameters": [ { "name": "x-api-key", "value": "={{ $env.FLEET_API_KEY }}" } ] },
        "options": { "timeout": 30000 }
      },
      "id": "fetch",
      "name": "Get vehicles",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [ 460, -100 ]
    },
    {
      "parameters": { "fieldToSplitOut": "vehicles", "options": {} },
      "id": "split",
      "name": "One item per vehicle",
      "type": "n8n-nodes-base.splitOut",
      "typeVersion": 1,
      "position": [ 680, -100 ]
    },
    {
      "parameters": {
        "jsCode": "// One output item per problem tyre.\n//\n// Two guards that matter:\n//  - a reading older than 10 minutes is not a current state (a truck in a\n//    no-coverage area returns its last message, not where it is now)\n//  - fault:true means the SENSOR is dead. Its numbers mean nothing — a 0°C\n//    from a dead sensor is not a cold tyre.\nconst TEMP_MAX = 90;      // °C\nconst PRESS_MIN = 90;     // psi\nconst MAX_AGE_SEC = 600;\n\nconst out = [];\nfor (const item of $input.all()) {\n  const v = item.json;\n  if ((v.dataAgeSeconds ?? 1e9) > MAX_AGE_SEC) continue;\n\n  for (const t of (v.tyres?.readings ?? [])) {\n    if (t.fault) continue;\n    const where = `axle ${t.axle}, position ${t.position}`;\n\n    if (t.tempC != null && t.tempC >= TEMP_MAX) {\n      out.push({ json: { plate: v.plate, driver: v.driver, kind: 'temperature',\n        value: t.tempC, unit: '°C', where,\n        message: `${v.plate}: tyre temperature ${t.tempC}°C (${where})` } });\n    }\n    if (t.pressurePsi != null && t.pressurePsi < PRESS_MIN) {\n      out.push({ json: { plate: v.plate, driver: v.driver, kind: 'pressure',\n        value: t.pressurePsi, unit: 'psi', where,\n        message: `${v.plate}: low pressure ${t.pressurePsi} psi (${where})` } });\n    }\n  }\n\n  if (v.maintenance?.status === 'overdue') {\n    out.push({ json: { plate: v.plate, kind: 'maintenance',\n      message: `${v.plate}: service overdue — ${v.maintenance.nextServiceName ?? 'unscheduled'}` } });\n  }\n}\nreturn out;"
      },
      "id": "rules",
      "name": "Apply thresholds",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [ 900, -100 ]
    },
    {
      "parameters": {
        "jsCode": "// The feed is down. Say so once — do not stay silent, because silence from a\n// stopped system looks exactly like 'everything is fine'.\nreturn [{ json: { kind: 'feed_down',\n  message: 'Fleet tracking feed is not reporting — tyre rules were not evaluated this run.',\n  newestReadingAgeSeconds: $json.newestReadingAgeSeconds } }];"
      },
      "id": "down",
      "name": "Feed is down",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [ 460, 120 ]
    }
  ],
  "connections": {
    "Every 5 minutes": { "main": [ [ { "node": "Check feed is alive", "type": "main", "index": 0 } ] ] },
    "Check feed is alive": { "main": [ [ { "node": "Feed healthy?", "type": "main", "index": 0 } ] ] },
    "Feed healthy?": { "main": [
      [ { "node": "Get vehicles", "type": "main", "index": 0 } ],
      [ { "node": "Feed is down", "type": "main", "index": 0 } ]
    ] },
    "Get vehicles": { "main": [ [ { "node": "One item per vehicle", "type": "main", "index": 0 } ] ] },
    "One item per vehicle": { "main": [ [ { "node": "Apply thresholds", "type": "main", "index": 0 } ] ] }
  },
  "settings": { "executionOrder": "v1" },
  "pinData": {}
}
```

The workflow reads the key from an environment variable `FLEET_API_KEY`.
Set it on your n8n instance, or replace `={{ $env.FLEET_API_KEY }}` in both HTTP
nodes with the key itself.

---

## Field paths for your own expressions

After **One item per vehicle**, each item is a single vehicle:

| Expression | Meaning |
|---|---|
| `{{ $json.plate }}` | plate number |
| `{{ $json.driver }}` | current driver |
| `{{ $json.dataAgeSeconds }}` | **age of the reading — check before acting** |
| `{{ $json.tyres.readings }}` | array, one entry per tyre |
| `{{ $json.tyres.readings[0].tempC }}` | temperature, °C |
| `{{ $json.tyres.readings[0].pressurePsi }}` | pressure, psi |
| `{{ $json.tyres.readings[0].fault }}` | **true = sensor dead, ignore its values** |
| `{{ $json.tyres.count }}` | how many tyres are reporting |
| `{{ $json.engine.coolantC }}` | engine coolant temperature |
| `{{ $json.engine.speedKmh }}` | current speed |
| `{{ $json.odometerKm }}` | odometer |
| `{{ $json.fuelPct }}` | fuel level, % |
| `{{ $json.maintenance.status }}` | `ok` \| `due` \| `overdue` |
| `{{ $json.maintenance.kmToService }}` | km until next service |
| `{{ $json.alerts.activeCount }}` | open alerts our system already raised |
| `{{ $json.position.lat }}` / `.lng` | location |

Full reference: **FLEET-API.md**

---

## Two rules worth keeping in your logic

**1. Check `dataAgeSeconds` before acting.** A truck in a no-coverage area returns
its last known message. Acting on a two-hour-old reading as if it were live is how
automations raise alerts about conditions that ended long ago.

**2. Skip tyres where `fault: true`.** That flag means the sensor itself is dead or
silent — its temperature and pressure are meaningless. A dead sensor reporting 0
is not a cold tyre, and treating it as one will bury you in false alerts.

Both are already handled in the workflow above.

---

## Alternative: let our thresholds drive your automation

Instead of computing rules yourself, poll `GET /alerts`. Those are raised using
thresholds our team edits on screen — so when we change a limit, your automation
follows without you touching anything.

```
https://api.energize-logistics.com/api/fleet-api/alerts
```

Same header. Filter with `?plate=` or `?type=`.
