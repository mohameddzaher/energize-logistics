# Energize Logistics — Live Fleet API

A **read-only** API that gives you the live state of the truck fleet: position, speed,
engine temperature, every individual tyre's temperature and pressure by its position on
the axle, maintenance status, and open alerts.

It is built for automation. Poll it on a schedule, apply your own rule — *"if any tyre
pressure drops below X"*, *"if a tyre temperature goes above 90°C"* — and send a message,
open a ticket, or trigger whatever you need.

Everything the Live Fleet screen shows is in this API.

---

## Base URL and key

```
https://api.energize-logistics.com/api/fleet-api
```

Every request carries the key in an `x-api-key` header:

```bash
curl -H "x-api-key: <YOUR_KEY>" \
  https://api.energize-logistics.com/api/fleet-api/vehicles
```

> Keep the key in an environment variable, not in committed source.
> A `?key=` query parameter also works for tools that cannot send headers, but query
> strings end up in access logs — the header is safer.

---

## Where the data comes from

Our system polls the tracking provider **every 20 seconds**, decodes the sensor channels,
and stores a snapshot per vehicle. You read our database, not the provider — so responses
are fast, your polling never consumes our provider quota no matter how often you call, and
the response carries data the provider does not have (our own tyre asset registry).

**Because of that, every response includes `dataAgeSeconds`** — how old the reading is.
A reading that is an hour old is not a current state. **Check it before acting on a value.**
A truck in a no-coverage area returns the last message received from it, not where it is now.

---

## Endpoints

### `GET /health`
Verifies your key and tells you whether the poll is alive. **Call this first.**

```json
{
  "ok": true,
  "generatedAt": "2026-08-26T10:20:00.000Z",
  "pollHealthy": true,
  "newestReadingAgeSeconds": 14
}
```

`pollHealthy: false` means the feed from the tracking provider has stopped.
**Do not raise or clear alerts on data in that state** — silence from a stopped system is
not the same as everything being fine.

---

### `GET /vehicles`
Every vehicle with its latest snapshot. Add `?plate=<plate>` to narrow to one.

```json
{
  "generatedAt": "2026-08-26T10:20:00.000Z",
  "count": 58,
  "vehicles": [
    {
      "plate": "3449 JTA",
      "name": "Truck 12",
      "unitId": 401234,
      "driver": "Driver name",

      "online": true,
      "status": "moving",
      "lastMessageAt": "2026-08-26T10:19:46.000Z",
      "dataAgeSeconds": 14,
      "lastSyncedAt": "2026-08-26T10:19:50.000Z",

      "position": { "lat": 21.48, "lng": 39.19, "speed": 82, "course": 140, "altitude": 12 },

      "engine": {
        "ignition": true, "moving": true, "speedKmh": 82,
        "rpm": 1450, "coolantC": 88, "engineHours": 12043
      },

      "odometerKm": 418302,
      "fuelPct": 61,
      "totalFuelUsedL": 38210,
      "weightKg": 32400,

      "power": { "mainV": 27.4, "backupV": 4.1, "gsmSignal": 4 },

      "tyres": {
        "count": 12,
        "faults": 1,
        "brand": "Continental",
        "maxTempC": 76, "minTempC": 48,
        "maxPressurePsi": 118, "minPressurePsi": 96,
        "readings": [
          { "axle": 1, "position": 1, "tempC": 52, "pressurePsi": 116, "fault": false },
          { "axle": 3, "position": 2, "tempC": 76, "pressurePsi": 96,  "fault": true  }
        ],
        "registered": { "mounted": 12, "spare": 2, "withSensor": 7 },
        "sensorChangeNotice": null
      },

      "alerts": { "level": "warning", "activeCount": 2 },

      "maintenance": {
        "status": "due",
        "overdueCount": 0,
        "dueCount": 1,
        "kmToService": 1420,
        "nextServiceKm": 420000,
        "nextServiceName": "Oil change",
        "upcomingServiceKm": 445000,
        "upcomingServiceName": "Brake inspection"
      },

      "profile": {
        "vin": "…", "brand": "Volvo", "modelYear": 2021,
        "vehicleType": "Tractor head", "registrationPlate": "3449 JTA",
        "installDate": "2024-03-11"
      }
    }
  ]
}
```

**Field notes that matter for automation:**

| Field | What to know |
|---|---|
| `tyres.readings` | This is what you build rules on — each tyre by axle and position. |
| `tyres.readings[].fault` | `true` means the **sensor** is faulty or silent. **Do not read its values** — a temperature reported as 0 by a dead sensor is not a cold tyre. |
| `tyres.registered` | From our own asset registry: how many tyres are actually mounted, how many spares, and how many have a sensor fitted. So `count: 7` is not a failure — it means 5 tyres do not have a sensor yet. |
| `dataAgeSeconds` | Age of the reading. Skip vehicles above your own threshold. |
| `alerts.level` / `activeCount` | What our system already flagged, using thresholds our team edits on screen. |
| `maintenance.*` | Service due/overdue by kilometres, with the next service name. |
| `profile.*` | Static vehicle data — VIN, brand, model year, type. |

Any field can be `null` when the vehicle has not reported it.

---

### `GET /vehicles/:plate`
One vehicle, same shape. URL-encode the plate.

---

### `GET /alerts`
Open alerts as our system sees them, using thresholds our team configures on screen.

```json
{
  "generatedAt": "2026-08-26T10:20:00.000Z",
  "count": 3,
  "alerts": [
    {
      "plate": "3449 JTA",
      "type": "tire_temp_high",
      "severity": "critical",
      "message": "High tyre temperature",
      "value": 94,
      "raisedAt": "2026-08-26T09:58:00.000Z",
      "ageSeconds": 1320
    }
  ]
}
```

Filters: `?plate=` and `?type=` (comma-separated for more than one type).

> **When to use this instead of your own rule:** when you want a threshold change made on
> our screen to reach your automation without you editing code. If you have a rule we do
> not model, compute it from `tyres.readings` yourself.

---

## Limits

| | |
|---|---|
| **Read-only** | No writes, ever. Automation watches and alerts; anyone changing data signs in as a person with their own permissions. |
| **10-second cache** | Two calls within a second return the same payload. The poll runs every 20s, so calling more often than that gains nothing. |
| **Recommended rate** | Once per minute. |
| **Alerts** | Up to 500 per response. |
| **Encoding** | UTF-8. Plates may contain Arabic — always `encodeURIComponent` them in query strings. |
| **Dates** | ISO 8601, UTC. |

---

## Working example

```javascript
const KEY = process.env.FLEET_API_KEY;
const BASE = 'https://api.energize-logistics.com/api/fleet-api';
const headers = { 'x-api-key': KEY };

async function check() {
  const health = await (await fetch(`${BASE}/health`, { headers })).json();
  // A stopped feed means stale data — and silence from it is not reassurance.
  if (!health.pollHealthy) {
    console.warn('Tracking feed is down — not evaluating rules right now');
    return;
  }

  const { vehicles } = await (await fetch(`${BASE}/vehicles`, { headers })).json();

  for (const v of vehicles) {
    if (v.dataAgeSeconds > 600) continue;         // reading older than 10 minutes: skip

    for (const t of v.tyres.readings) {
      if (t.fault) continue;                       // faulty sensor: its values mean nothing
      if (t.tempC != null && t.tempC >= 90) {
        notify(`${v.plate}: tyre temperature ${t.tempC}°C (axle ${t.axle}, position ${t.position})`);
      }
      if (t.pressurePsi != null && t.pressurePsi < 90) {
        notify(`${v.plate}: low pressure ${t.pressurePsi} psi (axle ${t.axle}, position ${t.position})`);
      }
    }

    if (v.maintenance.status === 'overdue') {
      notify(`${v.plate}: service overdue — ${v.maintenance.nextServiceName}`);
    }
  }
}

setInterval(check, 60_000);
```

---

## Errors

| Code | Meaning |
|---|---|
| `401` | Missing or wrong key |
| `404` | Plate not found |
| `503` | The key is not configured on the server — contact the system owner |
| `500` | Our error — retry with exponential backoff |

---

Contact the system owner for the key or for any question about a field.
