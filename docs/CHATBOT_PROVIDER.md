# BridgeAI provider and privacy

BridgeAI uses the OpenAI Responses API from `POST /api/chat`. The browser never
receives or stores the provider key. Configure the server with
`OPENAI_API_KEY`; `OPENAI_CHAT_MODEL` may override the default model.

The server sends the provider only:

- The latest chat message
- Interface language, current BridgeAid page, and self/helper mode
- A general location when the user has already entered one
- The selected service category and names of active filters
- IDs for selected or saved resources
- A bounded list of verified BridgeAid resource facts: official names, service,
  service area, hours, public contact details, source, verification date/status,
  and official URL

Helper notes, names, contact details entered by a helper, exact GPS coordinates,
and raw eligibility or nationwide-quiz answers are not sent. Quiz results can
still affect chat by changing which verified resource IDs BridgeAid supplies.

Requests use Structured Outputs and `store: false`. The server rejects unknown
resource IDs, limits message and request size, rate-limits by network address,
times out provider calls, and does not log message bodies or private workflow
data. Deployers remain responsible for reviewing the provider’s current API
terms, data controls, retention settings, regional requirements, and privacy
policy before production use. Relevant official references include the
[Responses API](https://developers.openai.com/api/docs/guides/responses),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
and [API data controls](https://developers.openai.com/api/docs/guides/your-data).

When the provider is missing, unavailable, slow, or returns invalid data,
BridgeAid shows a localized safe error. It does not fall back to keyword-based
resource claims.
