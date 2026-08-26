<!--
  رسالةٌ جاهزة لدعم Location Solutions — تُنسَخ كما هي.

  ملاحظة على الإملاء: النصّ يستعمل "tire" لا "tyre" — وهو ما تستعمله منصّة
  المزوّد نفسها في تسمية حسّاساتها (1st-Axle-Tire1). وأسماء القنوات
  (tire_temp_1_3 …) معرّفاتٌ حرفيّة عندهم لا تُترجَم ولا يُغيَّر إملاؤها،
  وإلا بحث فنيُّهم عن قناةٍ لا وجود لها.

  الأرقام في الجداول قِيست من سجلّ الرسائل الخام عبر واجهة المزوّد
  (messages/load_interval) على نافذة سبعة أيام — لا من شاشاتنا.
-->

**To:** Location Solutions Support
**Subject:** TPMS data not received — 6 vehicles (sensors configured, no transmission)

---

Dear Location Solutions Support Team,

We are writing about six vehicles in our fleet where TPMS (tire pressure and temperature) data is not reaching the platform, despite the sensors being physically installed.

**We have verified this from the raw message history via the API, not from our own interface.** Below is what we found.

### Case A — trailer sensors not transmitting (3 vehicles)

| Plate | Unit ID | Messages (7 days) | Messages carrying tire data | Channels received |
|---|---|---|---|---|
| 5799 VXA | 92875 | 3,000 | 2,986 | `1_1 1_2 2_1 2_2 3_2 4_2` |
| 5773 VXA | 92868 | 3,000 | 2,980 | `1_1 1_2 2_1 2_2 3_2 4_2` |
| 5774 VXA | 92873 | 3,000 | 2,965 | `1_1 1_2 2_1 2_2 3_2 4_2` |

Only the **six head-unit channels** arrive. The six trailer channels — `tire_temp_1_3`, `2_3`, `1_4`, `2_4`, `1_5`, `2_5` (axles 3, 4 and 5) — have **never** appeared in any message over the past 7 days.

Importantly, the sensor definitions on your platform are **correct and complete**. For unit 92875 we can see all twelve defined under Properties → Sensors, including `3rd-Axle-Tire1 TR-Pressure` through `5th-Axle-Tire2 TR-Pressure`. The configuration is not the problem — the trailer sensors are simply not transmitting to the head unit's TPMS gateway.

Our workshop records confirm the trailer sensors are physically fitted on these vehicles.

### Case B — no TPMS data at all (3 vehicles)

| Plate | Unit ID | Messages (7 days) | Messages carrying tire data |
|---|---|---|---|
| 7363 VSA | 95003 | 3,000 | **0** |
| 2706 SXA | 94917 | 3,000 | **0** |
| 1611 BGB | 278846 | 3,000 | **0** |

These units are online and transmitting position and CAN data normally, but not a single tire channel has been received in 7 days.

### What we are asking

1. Please check whether the TPMS sensors on these vehicles are correctly **paired to the telematics gateway** — the issue appears to be at the pairing/hardware level, not in the platform configuration.
2. Please advise whether anything on your side needs to be enabled for the trailer axles specifically on the three vehicles in Case A.

### One request for the future

We would appreciate it if your team could keep this in mind going forward: **when a sensor is defined on the platform but its channel never transmits, the data does not reach us at all** — so it does not appear in our system either.

This means that whenever new sensors are installed, we would be grateful if transmission could be verified — not just the sensor definition — before the installation is considered complete. That way we avoid raising a support ticket every time we install new sensors and find no data on our side.

We are happy to provide the raw message samples or any further detail your team may need.

Best regards,
**Energize Logistics**
