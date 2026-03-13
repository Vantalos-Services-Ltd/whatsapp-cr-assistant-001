# Contact Progress and Memory Pack Examples

## ContactProgressData Example

```json
{
  "missingFields": ["CSCS card", "phone number"],
  "nextAction": "Request CSCS card photo via WhatsApp",
  "followUpAt": "2024-02-05T10:00:00Z",
  "lastDecision": {
    "at": "2024-02-01T14:30:00Z",
    "by": "operator-123",
    "reason": "Candidate profile incomplete - missing CSCS verification"
  },
  "flags": {
    "waitingForOperator": false,
    "highPriority": true
  },
  "confidence": 85
}
```

## MemoryPack Example

```json
{
  "summary": "Bricklayer from Maidstone looking for immediate work, has Green CSCS card, prefers residential projects.",
  "facts": {
    "trade": "Bricklayer",
    "location": "Maidstone, Kent",
    "availability": "Available immediately, Monday to Friday",
    "salary": {
      "min": 18,
      "max": 22,
      "currency": "GBP"
    },
    "skills": ["Brickwork", "Blockwork", "Pointing"],
    "tickets": ["Green CSCS", "CPCS"],
    "preferredAreas": ["Maidstone", "Medway", "Canterbury"],
    "transport": "Own vehicle",
    "startDate": "2024-02-05",
    "lastClient": "ABC Construction Ltd"
  },
  "goal": "Find steady residential bricklaying work in Kent area",
  "openQuestions": [
    "What is your preferred daily rate?",
    "Are you available for weekend work?"
  ],
  "lastJobDiscussed": {
    "jobId": "job-456",
    "title": "Maidstone Residential Development",
    "location": "Maidstone, Kent",
    "startDate": "2024-02-05"
  },
  "nextAction": "Send job details and confirm availability",
  "lastUpdatedAt": "2024-02-01T15:45:00Z",
  "version": 1
}
```

## Minimal ProgressData Example

```json
{
  "missingFields": [],
  "nextAction": null,
  "followUpAt": null,
  "lastDecision": null,
  "flags": {},
  "confidence": 50
}
```

## Minimal MemoryPack Example

```json
{
  "summary": "New contact - profile being built",
  "facts": {
    "trade": null,
    "location": null,
    "availability": null,
    "salary": null,
    "skills": null,
    "tickets": null,
    "preferredAreas": null,
    "transport": null,
    "startDate": null,
    "lastClient": null
  },
  "goal": "",
  "openQuestions": [],
  "lastJobDiscussed": null,
  "nextAction": "Collect basic profile information",
  "lastUpdatedAt": "2024-02-01T10:00:00Z",
  "version": 1
}
```

