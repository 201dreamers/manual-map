# Traffic Data API Research

**Date:** 2026-09-23
**Question:** Can the OpenWeb Ninja Waze API supply live traffic to Manual Map? Does it work, what does it cost, how hard is it to use?
**Verdict:** Do not adopt. Use Mapbox congestion annotations on the Directions call the app already makes.

## 1. What the OpenWeb Ninja Waze API actually is

A third-party scraper wrapper around Waze's undocumented internal live-map endpoints, resold as a clean REST API. It is not operated by Waze or Google, and it carries no relationship with them.

Source: <https://www.openwebninja.com/api/waze>

### Endpoints

| Endpoint | Returns |
|---|---|
| `/waze/alerts-and-jams` | Accidents, hazards, police, road closures, weather events, plus jam polylines |
| Driving directions | Route alternatives with duration, distance, toll info, and alerts along the route |
| Location search | Query autocomplete for place names and addresses |

### Response shapes

- **Alert object** - `alert_id`, `type` (e.g. `ROAD_CLOSED`), `publish_datetime_utc`, city / street / lat / lon, `num_thumbs_up`, `alert_reliability`, `alert_confidence`.
- **Jam object** - `jam_id`, severity level 1-5, `speed_kmh`, `length_meters`, polyline coordinates, linked blocking-alert reference.

## 2. Ease of integration

Low friction. A GET with an `x-api-key` header and a bounding box. No OAuth, no signing, no SDK, so it would fit the zero-new-dependency constraint and mirror the existing shape of `src/lib/directions.ts`.

```
GET https://api.openwebninja.com/waze/alerts-and-jams
  ?bottom_left=40.66615,-74.13732
  &top_right=40.77278,-73.76818
x-api-key: YOUR_API_KEY
```

Area can be given as a bounding box or as a center point plus radius. Alert type/subtype filtering and per-call result limits are available.

## 3. Limits and pricing

| Plan | Cost | Requests / month | Overage | Rate limit |
|---|---|---|---|---|
| Free | $0 | 100 | Hard stop | 1000 req/hour |
| Pro | $25/mo | 10,000 | $0.003/req | 10 req/sec |
| Ultra | $75/mo | 50,000 | $0.002/req | 20 req/sec |
| Mega | $150/mo | 200,000 | $0.001/req | 30 req/sec |
| Pay as you go | $0.005/req | Unmetered | N/A | 10 req/sec |

Also available via RapidAPI with identical endpoints and response shapes, though pricing and rate limits may differ between the two channels.

### Hard per-call caps

- Maximum **200 alerts** and **800 jams** per request.
- Large areas must be split into smaller bounding boxes or incidents are silently missed. That multiplies the request count for any wide-area view.

### Cost modelling for this app

The free tier's 100 requests/month is a demo allowance, not a development budget - a single driving session polling every 30 seconds exhausts it in under an hour. Polling once per minute during playback costs roughly 60 requests/hour, so the $25 Pro tier covers about seven hours per day for **one** user. This does not scale cheaply per-user.

## 4. Reliability

- Built on undocumented internal endpoints, so Waze can change or block them at any time.
- No SLA, no deprecation notice, no support escalation path.
- **Real-time only. No historical data**, so there is no way to query past conditions or replay previous traffic.

## 5. Terms of service - the deciding factor

Waze's Terms of Use prohibit accessing content by automated means, systematically downloading content to build a database, commercial use, and specifically offering to third parties any service that uses Waze or its content.

Sources: <https://support.google.com/waze/answer/12373727?hl=en>, <https://transparency.google/intl/en_be/our-policies/product-terms/waze/>

That creates two separate exposures:

1. **The reseller is in violation.** Their entire business model is the prohibited activity. If Google enforces, the dependency disappears without warning.
2. **A consumer of the reseller is also exposed.** Buying the data from a middleman does not grant rights the middleman never held.

This is a contract and ToS matter rather than a criminal one, with additional GDPR/CCPA considerations if the user-generated report data is stored. It is nonetheless sufficient to rule the API out for anything shipped publicly or monetised.

## 6. Recommended alternatives

### Mapbox (preferred - already in the stack)

- **`annotations=congestion,duration` on the existing Directions request.** Returns per-segment congestion for the route already being built in `src/lib/directions.ts`. No extra requests, no extra cost, no new dependency, no ToS issue. Roughly an afternoon of work.
- **`mapbox://mapbox.mapbox-traffic-v1` tileset.** Congestion-coloured roads as a map layer, drops directly into `MapView.tsx`.
- Incident data is available through the Mapbox Navigation SDK / Incidents data if an alert layer is wanted later.

### TomTom (if richer incident data is needed)

Official, licensed Traffic Incidents API with a free tier of 2,500 requests/day versus 100/month, fully documented and with no scraping involved.

## 7. When the Waze route would still make sense

Only for a throwaway personal experiment that is never shipped, and only where crowd-sourced police and hazard reports are the specific requirement - that is genuinely data no licensed provider offers. It should not enter a product.
