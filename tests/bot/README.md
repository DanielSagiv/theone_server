# Bot Testing Infrastructure

This directory contains tests for the bot/AI system.

## Test Structure

```
tests/bot/
├── unit/              # Unit tests for individual services
│   ├── botPreferenceService.test.js
│   ├── botSentimentService.test.js
│   ├── botAutoFillService.test.js
│   └── dateParser.test.js
├── integration/       # Integration tests for tool handlers
│   ├── botToolHandlers.test.js
│   └── botService.test.js
├── e2e/              # End-to-end conversation flows
│   ├── coe_creation.test.js
│   ├── event_query.test.js
│   └── preference_collection.test.js
└── fixtures/          # Test data fixtures
    ├── events.json
    ├── locations.json
    └── users.json
```

## Running Tests

```bash
# Run all bot tests
npm test -- tests/bot

# Run unit tests only
npm test -- tests/bot/unit

# Run integration tests only
npm test -- tests/bot/integration

# Run E2E tests only
npm test -- tests/bot/e2e
```

## Test Coverage Goals

- **Unit Tests**: 80%+ coverage for utility services
- **Integration Tests**: All tool handlers tested
- **E2E Tests**: All conversation patterns from prompts.csv

## Notes

- Tests use a test database (configured via `TEST_MONGODB_URI`)
- Tests clean up after themselves
- E2E tests may require OpenAI API key (use mock responses in CI)

